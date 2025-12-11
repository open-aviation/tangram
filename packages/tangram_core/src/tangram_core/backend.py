from __future__ import annotations

import asyncio
import importlib.resources
import json
import logging
import os
import re
import sys
import urllib.parse
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
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

if sys.version_info >= (3, 11):
    pass
else:
    pass

import httpx
import platformdirs
import redis.asyncio as redis
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles

from .config import CacheEntry, Config, FrontendChannelConfig, FrontendConfig
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
                and (
                    path1 := Path(urllib.parse.unquote(urllib.parse.urlparse(url).path))
                ).is_dir()
            ):
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
    app: FastAPI, backend_state: BackendState
) -> AsyncGenerator[None, None]:
    # we don't need to __aenter__ httpx.AsyncClient again
    async with backend_state.redis_client:
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


def create_app(
    backend_state: BackendState,
    loaded_plugins: Iterable[Plugin],
) -> FastAPI:
    app = FastAPI(
        lifespan=partial(lifespan, backend_state=backend_state),
        default_response_class=ORJSONResponse,
    )
    frontend_plugins = {}

    for plugin in loaded_plugins:
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

                    conf_backend = backend_state.config.plugins.get(
                        plugin.dist_name, {}
                    )
                    if to_frontend_conf := plugin.into_frontend_config_function:
                        conf_frontend = to_frontend_conf(conf_backend)
                    else:
                        conf_frontend = conf_backend

                    plugin_meta["config"] = conf_frontend
                    frontend_plugins[plugin.dist_name] = plugin_meta
                except Exception as e:
                    logger.error(
                        f"failed to read plugin.json for {plugin.dist_name}: {e}"
                    )

    # unlike v0.1 which uses `process.env`, v0.2 *compiles* the js so we no
    # no longer have access to it, so we selectively forward the config.
    @app.get("/config")
    async def get_frontend_config(
        state: Annotated[BackendState, Depends(get_state)],
    ) -> FrontendConfig:
        channel_cfg = state.config.channel
        if channel_cfg.public_url:
            channel_url = channel_cfg.public_url
        else:
            # for local/non-proxied setups, user must set a reachable host.
            # '0.0.0.0' is for listening, not connecting.
            host = "localhost" if channel_cfg.host == "0.0.0.0" else channel_cfg.host
            channel_url = f"http://{host}:{channel_cfg.port}"

        return FrontendConfig(
            channel=FrontendChannelConfig(url=channel_url),
            map=state.config.map,
        )

    @app.get("/manifest.json")
    async def get_manifest() -> ORJSONResponse:
        return ORJSONResponse(content={"plugins": frontend_plugins})

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


async def run_services(
    backend_state: BackendState,
    loaded_plugins: Iterable[Plugin],
) -> AsyncGenerator[asyncio.Task[None], None]:
    yield asyncio.create_task(run_channel_service(backend_state.config))

    for plugin in loaded_plugins:
        for _, service_func in sorted(
            plugin.services, key=lambda s: (s[0], s[1].__name__)
        ):
            yield asyncio.create_task(service_func(backend_state))
            logger.info(f"started service from plugin: {plugin.dist_name}")


async def run_server(backend_state: BackendState, loaded_plugins: list[Plugin]) -> None:
    app_instance = create_app(backend_state, loaded_plugins)
    server_config = uvicorn.Config(
        app_instance,
        host=backend_state.config.server.host,
        port=backend_state.config.server.port,
        log_config=get_log_config_dict(backend_state.config),
    )
    server = uvicorn.Server(server_config)
    await server.serve()


async def start_tasks(config: Config) -> None:
    loaded_plugins = load_enabled_plugins(config)

    async with AsyncExitStack() as stack:
        redis_client = await stack.enter_async_context(
            redis.from_url(config.core.redis_url)  # type: ignore
        )
        http_client = await stack.enter_async_context(httpx.AsyncClient(http2=True))
        state = BackendState(
            redis_client=redis_client, http_client=http_client, config=config
        )

        server_task = asyncio.create_task(run_server(state, loaded_plugins))
        service_tasks = [s async for s in run_services(state, loaded_plugins)]

        await asyncio.gather(server_task, *service_tasks)


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
