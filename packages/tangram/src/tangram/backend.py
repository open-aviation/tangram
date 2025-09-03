from __future__ import annotations

import asyncio
import importlib.resources
import json
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from functools import partial
from importlib.abc import Traversable
from importlib.metadata import Distribution, PackageNotFoundError
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, AsyncGenerator, Iterable, TypeAlias

import redis.asyncio as redis
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .plugin import load_plugin, scan_plugins

if TYPE_CHECKING:
    from .config import Config
    from .plugin import DistName, Plugin

logger = logging.getLogger(__name__)


# see https://www.starlette.io/lifespan/#lifespan-state
@dataclass
class BackendState:
    redis_client: redis.Redis
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

    @app.get("/manifest.json")
    async def get_manifest() -> JSONResponse:
        return JSONResponse(content={"plugins": frontend_plugins})

    core_frontend_path = resolve_frontend(path="dist-frontend", dist_name="tangram")
    app.mount(
        "/", StaticFiles(directory=str(core_frontend_path), html=True), name="core"
    )
    return app


LOG_LEVEL_MAP = {
    "TRACE": logging.DEBUG,
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "ERROR": logging.ERROR,
}


class TracingLayer:
    def __init__(self, log_levels: dict[str, str], default_level: str):
        self.log_levels = {k: v.upper() for k, v in log_levels.items()}
        self.default_level = default_level.upper()

    def on_event(self, event: str, state: None) -> None:
        data = json.loads(event)
        metadata = data.get("metadata", {})
        target = metadata.get("target", "")
        level_str = metadata.get("level", "INFO")
        message = data.get("message", "")

        if not all([target, level_str, message]):
            return

        crate_name = target.split("::", 1)[0]

        config_level_str = self.log_levels.get(crate_name, self.default_level)
        config_level = LOG_LEVEL_MAP.get(config_level_str, logging.INFO)
        event_level = LOG_LEVEL_MAP.get(level_str, logging.INFO)

        if event_level >= config_level:
            logger = logging.getLogger(target)
            logger.log(event_level, message)

    def on_new_span(self, span_attrs: str, span_id: str) -> None:
        return None

    def on_close(self, span_id: str, state: None) -> None:
        pass

    def on_record(self, span_id: str, values: str, state: None) -> None:
        pass


async def run_channel_service(config: Config) -> None:
    from ._channel import ChannelConfig, init_tracing, run

    layer = TracingLayer(log_levels={}, default_level=config.core.log_level)
    init_tracing(layer)

    rust_config = ChannelConfig(
        host=config.channel.host,
        port=config.channel.port,
        redis_url=config.core.redis_url,
        jwt_secret=config.channel.jwt_secret,
        jwt_expiration_secs=config.channel.jwt_expiration_secs,
    )
    await run(rust_config)


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
        log_level="info",
    )
    server = uvicorn.Server(server_config)
    await server.serve()


async def start_tasks(config: Config) -> None:
    loaded_plugins = load_enabled_plugins(config)

    async with AsyncExitStack() as stack:
        redis_client = await stack.enter_async_context(
            redis.from_url(config.core.redis_url)  # type: ignore
        )
        state = BackendState(redis_client=redis_client, config=config)

        server_task = asyncio.create_task(run_server(state, loaded_plugins))
        service_tasks = [s async for s in run_services(state, loaded_plugins)]

        await asyncio.gather(server_task, *service_tasks)
