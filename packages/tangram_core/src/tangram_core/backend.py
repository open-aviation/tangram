from __future__ import annotations

import asyncio
import importlib.resources
import json
import logging
import os
import re
import traceback
import urllib.parse
import urllib.request
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from functools import partial
from importlib.metadata import Distribution, PackageNotFoundError
from pathlib import Path
from typing import (
    TYPE_CHECKING,
    Annotated,
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Iterable,
    TypeAlias,
)

import httpx
import platformdirs
import redis.asyncio as redis
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter, ValidationError

from .config import (
    CacheEntry,
    Config,
    FrontendChannelConfig,
    FrontendConfig,
    IntoConfig,
    ThemeDefinition,
    parse_frontend_config,
    to_frontend_manifest,
)
from .plugin import load_plugin, scan_plugins

if TYPE_CHECKING:
    from .plugin import Plugin

logger = logging.getLogger(__name__)


# see https://www.starlette.io/lifespan/#lifespan-state
@dataclass
class BackendState:
    redis_client: redis.Redis
    http_client: httpx.AsyncClient
    config: Config
    loaded_plugins: dict[str, Plugin] = field(default_factory=dict)

    @property
    def base_url(self) -> str:
        host = self.config.server.host
        port = self.config.server.port
        if host == "0.0.0.0":
            host = "127.0.0.1"
        return f"http://{host}:{port}"


async def get_state(request: Request) -> BackendState:
    return request.app.state.backend_state  # type: ignore


InjectBackendState: TypeAlias = Annotated[BackendState, Depends(get_state)]


def get_distribution_path(dist_name: str) -> Path:
    """Get the local path of a distribution, handling both editable installs
    (`direct_url.json`) and standard wheel installs.

    See: https://packaging.python.org/en/latest/specifications/direct-url-data-structure/
    """
    # always try direct_url.json first (e.g. for the case of `uv sync --all-packages`)
    try:
        dist = Distribution.from_name(dist_name)
        if direct_url_content := dist.read_text("direct_url.json"):
            direct_url_data = json.loads(direct_url_content)
            if (
                (url := direct_url_data.get("url"))
                # url may point to a git or zip archive, but since we only care
                # about local paths, we only handle the file:// scheme here
                and url.startswith("file://")
            ):
                parsed = urllib.parse.urlparse(url)
                if os.name == "nt":
                    path_str = urllib.request.url2pathname(parsed.path)
                    if parsed.netloc and parsed.netloc not in ("", "localhost"):
                        path_str = f"//{parsed.netloc}{path_str}"
                    path1 = Path(path_str)
                else:
                    path1 = Path(urllib.parse.unquote(parsed.path))
                if path1.is_dir():
                    return path1
    except (PackageNotFoundError, json.JSONDecodeError, FileNotFoundError):
        pass

    # fallback in case it was installed via a wheel
    if (trav := importlib.resources.files(dist_name)).is_dir():
        with importlib.resources.as_file(trav) as path2:
            return path2
    raise FileNotFoundError(f"could not find distribution path for {dist_name}")


def resolve_frontend(plugin: Plugin) -> Path | None:
    if not plugin.frontend_path:
        return None
    return get_distribution_path(plugin.dist_name) / plugin.frontend_path


def load_enabled_plugins(
    config: Config,
) -> list[Plugin]:
    loaded_plugins = []
    enabled_plugin_names = set(config.core.plugins)

    for entry_point in scan_plugins():
        # TODO: should we check entry_point.dist.name instead?
        if entry_point.name not in enabled_plugin_names:
            continue
        if (plugin := load_plugin(entry_point)) is not None:
            loaded_plugins.append(plugin)

    return loaded_plugins


@asynccontextmanager
async def lifespan(
    app: FastAPI, backend_state: BackendState, loaded_plugins: Iterable[Plugin]
) -> AsyncGenerator[None, None]:
    async with AsyncExitStack() as stack:
        for plugin in loaded_plugins:
            if plugin.lifespan:
                logger.info(f"initializing lifespan for {plugin.dist_name}")
                await stack.enter_async_context(plugin.lifespan(backend_state))

        app.state.backend_state = backend_state
        yield


def default_cache_dir() -> Path:
    if (xdg_cache := os.environ.get("XDG_CACHE_HOME")) is not None:
        cache_dir = Path(xdg_cache) / "tangram"
    else:
        cache_dir = Path(platformdirs.user_cache_dir(appname="tangram"))
    if not cache_dir.exists():
        cache_dir.mkdir(parents=True, exist_ok=True)

    return cache_dir


CACHE_PARAM_PATTERN = re.compile(r"\{(\w+)\}")


def make_cache_route_handler(
    entry: CacheEntry, state: BackendState
) -> Callable[..., Awaitable[FileResponse]]:
    """
    Factory function that creates a route handler for caching and serving files.
    Dynamically handles URL parameters found in both serve_route and origin.

    :param entry: Cache entry configuration
    :param state: Backend state with http_client for fetching remote resources
    :returns: Async function that handles the route with dynamic parameters
    """
    from inspect import Parameter, Signature

    # Extract parameter names from the serve_route (e.g., {fontstack}, {range})
    params = CACHE_PARAM_PATTERN.findall(entry.serve_route)

    async def cache_route_handler(**kwargs: str) -> FileResponse:
        if (local_path := entry.local_path) is None:
            local_path = default_cache_dir()
        else:
            local_path = local_path.expanduser()

        # Build the local file path by replacing parameters
        local_file = local_path
        for param in params:
            if param in kwargs:
                local_file = local_file / kwargs[param]

        logger.info(f"Serving cached file from {local_file}")

        if not local_file.exists():
            assert entry.origin is not None
            # Build the remote URL by replacing parameters
            remote_url = entry.origin
            for param, value in kwargs.items():
                remote_url = remote_url.replace(f"{{{param}}}", value)

            logger.info(f"Downloading from {remote_url} to {local_file}")
            c = await state.http_client.get(remote_url)
            c.raise_for_status()
            local_file.parent.mkdir(parents=True, exist_ok=True)
            local_file.write_bytes(c.content)

        return FileResponse(path=local_file, media_type=entry.media_type)

    # Create explicit parameters for the function signature
    sig_params = [
        Parameter(
            name=param,
            kind=Parameter.POSITIONAL_OR_KEYWORD,
            annotation=str,
        )
        for param in params
    ]
    cache_route_handler.__signature__ = Signature(  # type: ignore
        parameters=sig_params,
        return_annotation=FileResponse,
    )

    return cache_route_handler


DEFAULT_THEMES = (
    ThemeDefinition(
        name="light",
        background="#ffffff",
        foreground="#000000",
        surface="#f8f9fa",
        border="#e7e7e7",
        hover="#e9ecef",
        accent1="oklch(0.5616 0.0895 251.64)",
        accent1_foreground="#ffffff",
        accent2="oklch(0.8021 0.11 92.43)",
        accent2_foreground="#000000",
        muted="#666666",
        error="#8e1b27",
    ),
    ThemeDefinition(
        name="dark",
        background="#1a1a1a",
        foreground="#e0e0e0",
        surface="#2d2d2d",
        border="#404040",
        hover="#343434",
        accent1="oklch(0.5059 0.0895 251.64)",
        accent1_foreground="#ffffff",
        accent2="oklch(0.5059 0.0895 93.53)",
        accent2_foreground="#ffffff",
        muted="#999999",
        error="#844d53",
    ),
)


def core_into_frontend_config(config: Config) -> FrontendConfig:
    if config.channel.public_url:
        channel_url = config.channel.public_url
    else:
        host = "localhost" if config.channel.host == "0.0.0.0" else config.channel.host
        channel_url = f"http://{host}:{config.channel.port}"
    frontend_channel = FrontendChannelConfig(url=channel_url)

    user_theme_names = {t.name for t in config.core.themes}
    merged_themes = [
        t for t in DEFAULT_THEMES if t.name not in user_theme_names
    ] + config.core.themes

    frontend_core = replace(config.core, themes=merged_themes)

    return FrontendConfig(core=frontend_core, map=config.map, channel=frontend_channel)


def create_app(
    backend_state: BackendState,
    loaded_plugins: Iterable[Plugin],
) -> FastAPI:
    app = FastAPI(
        lifespan=partial(
            lifespan, backend_state=backend_state, loaded_plugins=loaded_plugins
        ),
        default_response_class=ORJSONResponse,
    )

    frontend_config_instance = core_into_frontend_config(backend_state.config)
    frontend_adapter = TypeAdapter(FrontendConfig)
    manifest_core = to_frontend_manifest(frontend_adapter, frontend_config_instance)

    manifest_plugins = {}
    for plugin in loaded_plugins:
        backend_state.loaded_plugins[plugin.dist_name] = plugin
        for router in plugin.routers:
            app.include_router(router)

        if (frontend_path_resolved := resolve_frontend(plugin)) is not None:
            app.mount(
                f"/plugins/{plugin.dist_name}",
                StaticFiles(directory=str(frontend_path_resolved)),
                name=plugin.dist_name,
            )
            plugin_json_path = frontend_path_resolved / "plugin.json"
            if plugin_json_path.exists():
                try:
                    with plugin_json_path.open("rb") as f:
                        plugin_meta = json.load(f)

                    conf_dict = backend_state.config.plugins.get(plugin.dist_name, {})
                    # TODO when we have with_computed_fields we need to update the
                    # schema as well, so the current way of spreading into is incorrect
                    full_config = {}
                    schema = {}

                    if (adapter := plugin.adapter()) is not None:
                        conf_instance = adapter.validate_python(conf_dict)
                        frontend_manifest = to_frontend_manifest(adapter, conf_instance)
                        full_config = frontend_manifest["config"]
                        schema = frontend_manifest["config_json_schema"]

                        if plugin.with_computed_fields is not None:
                            full_config.update(
                                plugin.with_computed_fields(
                                    backend_state, conf_instance
                                )
                            )
                    elif plugin.with_computed_fields is not None:
                        full_config.update(
                            plugin.with_computed_fields(backend_state, conf_dict)
                        )

                    plugin_meta["config"] = full_config
                    plugin_meta["config_json_schema"] = schema
                    manifest_plugins[plugin.dist_name] = plugin_meta
                except Exception as e:
                    trace = traceback.format_exc()
                    logger.error(
                        "failed to read plugin.json for %s: %s\n%s",
                        plugin.dist_name,
                        e,
                        trace,
                    )

    @app.post("/settings/validate/{plugin_name}")
    async def validate_settings(
        plugin_name: str,
        data: dict,
        state: Annotated[BackendState, Depends(get_state)],
    ) -> dict:
        SUCCESS = {"success": True, "errors": {}}
        try:
            if plugin_name == "tangram_core":
                _ = parse_frontend_config(frontend_adapter, data)
                return SUCCESS
            plugin = state.loaded_plugins.get(plugin_name)
            assert plugin is not None, f"plugin {plugin_name} not found"
            backend_adapter = plugin.adapter()
            assert backend_adapter is not None, f"plugin {plugin_name} has no adapter"
            _ = parse_frontend_config(backend_adapter, data)
            return SUCCESS
        except ValidationError as e:
            errs = {
                ".".join(str(loc) for loc in err["loc"]): err["msg"]
                for err in e.errors()
            }
            return {"success": False, "errors": errs}

    @app.get("/manifest.json")
    async def get_manifest() -> ORJSONResponse:
        return ORJSONResponse(
            content={"core": manifest_core, "plugins": manifest_plugins}
        )

    # Cache mechanism - MUST be registered BEFORE the catch-all frontend mount
    for cache_entry in backend_state.config.cache.entries:
        logger.info(
            f"caching {cache_entry.origin} to {cache_entry.local_path} "
            f"and serving at {cache_entry.serve_route}"
        )
        route_handler = make_cache_route_handler(cache_entry, backend_state)

        logger.info(
            f"Registering route: GET {cache_entry.serve_route} with dynamic params"
        )
        app.add_api_route(
            cache_entry.serve_route,
            route_handler,
            methods=["GET"],
            name=f"cache-{cache_entry.serve_route.replace('/', '_')}",
        )

    if not (
        frontend_path := get_distribution_path("tangram_core") / "dist-frontend"
    ).is_dir():
        raise ValueError(
            f"error: frontend {frontend_path} was not found, "
            "did you run `pnpm i && pnpm run build`?"
        )
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="core")

    return app


async def run_channel_service(config: Config) -> None:
    from . import _core

    _core.init_tracing_stderr(config.core.log_level)

    rust_config = _core.ChannelConfig(
        host=config.channel.host,
        port=config.channel.port,
        redis_url=config.core.redis_url,
        jwt_secret=config.channel.jwt_secret,
        jwt_expiration_secs=config.channel.jwt_expiration_secs,
        id_length=config.channel.id_length,
    )
    await _core.run(rust_config)


class Runtime:
    """Manages the lifecycle of the Tangram backend, including the
    Uvicorn server, background services, and connection pools (Redis, HTTPX).
    """

    def __init__(self, config: IntoConfig | None = None) -> None:
        if isinstance(config, (str, Path, os.PathLike)):
            self.config = Config.from_file(config)
        else:
            self.config = config or Config()
        self._stack = AsyncExitStack()
        self._state: BackendState | None = None
        self._server: uvicorn.Server | None = None
        self._server_task: asyncio.Task[None] | None = None
        self._service_tasks: list[asyncio.Task[None]] = []

    @property
    def state(self) -> BackendState:
        if self._state is None:
            raise RuntimeError("runtime is not started, call start() first")
        return self._state

    async def start(self) -> Runtime:
        """Starts the backend runtime."""
        if self._state is not None:
            raise RuntimeError("runtime is already started")

        redis_client = await self._stack.enter_async_context(
            redis.from_url(self.config.core.redis_url)  # type: ignore
        )
        http_client = await self._stack.enter_async_context(
            httpx.AsyncClient(http2=True)
        )
        self._state = BackendState(
            redis_client=redis_client,
            http_client=http_client,
            config=self.config,
        )

        loaded_plugins = load_enabled_plugins(self.config)
        app = create_app(self._state, loaded_plugins)

        server_config = uvicorn.Config(
            app,
            host=self.config.server.host,
            port=self.config.server.port,
            log_config=get_log_config_dict(self.config),
        )
        self._server = uvicorn.Server(server_config)

        self._service_tasks.append(
            asyncio.create_task(run_channel_service(self.config))
        )
        for plugin in loaded_plugins:
            for _, service_func in sorted(
                plugin.services, key=lambda s: (s[0], s[1].__name__)
            ):
                self._service_tasks.append(
                    asyncio.create_task(service_func(self._state))
                )
                logger.info(f"started service from plugin: {plugin.dist_name}")

        self._server_task = asyncio.create_task(self._server.serve())

        while not self._server.started:
            if self._server_task.done():
                await self._server_task
            await asyncio.sleep(0.1)

        return self

    async def wait(self) -> None:
        """Waits for the server task to complete (e.g. via signal or internal error)."""
        if self._server_task:
            try:
                await self._server_task
            except asyncio.CancelledError:
                pass

    async def stop(self) -> None:
        """Stops the backend runtime."""
        if self._server and self._server.started:
            self._server.should_exit = True
            if self._server_task:
                try:
                    await self._server_task
                except asyncio.CancelledError:
                    pass

        for task in self._service_tasks:
            task.cancel()
        if self._service_tasks:
            await asyncio.gather(*self._service_tasks, return_exceptions=True)
        self._service_tasks.clear()

        await self._stack.aclose()
        self._state = None
        self._server = None
        self._server_task = None

    async def __aenter__(self) -> Runtime:
        return await self.start()

    async def __aexit__(self, *args: Any) -> None:
        await self.stop()


def get_log_config_dict(config: Config) -> dict[str, Any]:
    def format_time(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ ")

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "default": {
                "class": "rich.logging.RichHandler",
                "log_time_format": format_time,
                "omit_repeated_times": False,
            },
        },
        "root": {"handlers": ["default"], "level": config.core.log_level.upper()},
    }
