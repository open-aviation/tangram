from __future__ import annotations

import asyncio
import importlib.resources
import json
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from importlib.metadata import Distribution, PackageNotFoundError
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, AsyncGenerator, Iterable, TypeAlias

import httpx
import redis.asyncio as redis
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Config, FrontendChannelConfig, FrontendConfig
from .plugin import load_plugin, scan_plugins

if TYPE_CHECKING:
    from .plugin import DistName, Plugin

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


def resolve_frontend(*, path: str, dist_name: str) -> Path | Traversable | None:
    # always try to parse from direct url first (this is robust for editable
    # installs like `uv sync --all-packages`)
    try:
        dist = Distribution.from_name(dist_name)
        if direct_url_content := dist.read_text("direct_url.json"):
            direct_url_data = json.loads(direct_url_content)
            if (url := direct_url_data.get("url")) and (
                path1 := Path(url.removeprefix("file://")) / path
            ).is_dir():
                return path1
    except (PackageNotFoundError, json.JSONDecodeError, FileNotFoundError):
        pass

    # fallback in case it was installed via pip
    if (path2 := importlib.resources.files(dist_name) / path).is_dir():
        return path2
    return None


def load_enabled_plugins(
    config: Config,
) -> list[tuple[DistName, Plugin]]:
    loaded_plugins = []
    enabled_plugin_names = set(config.core.plugins)

    for entry_point in scan_plugins():
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


def create_app(
    backend_state: BackendState,
    loaded_plugins: Iterable[tuple[DistName, Plugin]],
) -> FastAPI:
    app = FastAPI(lifespan=partial(lifespan, backend_state=backend_state))
    frontend_plugins = []

    for dist_name, plugin in loaded_plugins:
        for router in plugin.routers:
            app.include_router(router)

        if (p := plugin.frontend_path) is not None and (
            frontend_path_resolved := resolve_frontend(path=p, dist_name=dist_name)
        ) is not None:
            app.mount(
                f"/plugins/{dist_name}",
                StaticFiles(directory=str(frontend_path_resolved)),
                name=dist_name,
            )
            frontend_plugins.append(dist_name)

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
    async def get_manifest() -> JSONResponse:
        return JSONResponse(content={"plugins": frontend_plugins})

    # TODO: we might want to host the frontend separately from the backend
    if (
        frontend_path := resolve_frontend(
            path="dist-frontend", dist_name="tangram_core"
        )
    ) is None:
        raise ValueError(
            "error: frontend was not found, did you run `pnpm i && pnpm run build`?"
        )
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="core")
    return app


LOG_LEVEL_MAP = {
    "TRACE": logging.DEBUG,
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "ERROR": logging.ERROR,
}


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
    loaded_plugins: Iterable[tuple[DistName, Plugin]],
) -> AsyncGenerator[asyncio.Task[None], None]:
    yield asyncio.create_task(run_channel_service(backend_state.config))

    for dist_name, plugin in loaded_plugins:
        for _, service_func in sorted(
            plugin.services, key=lambda s: (s[0], s[1].__name__)
        ):
            yield asyncio.create_task(service_func(backend_state))
            logger.info(f"started service from plugin: {dist_name}")


async def run_server(
    backend_state: BackendState, loaded_plugins: list[tuple[DistName, Plugin]]
) -> None:
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
