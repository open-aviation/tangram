from __future__ import annotations

import asyncio
import importlib.resources
import json
import logging
from contextlib import asynccontextmanager
from importlib.abc import Traversable
from importlib.metadata import Distribution, PackageNotFoundError
from pathlib import Path
from typing import AsyncGenerator, Iterable

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Config
from .plugin import DistName, Plugin, load_plugin, scan_plugins

logger = logging.getLogger(__name__)


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


# TODO: use functools.partial and contextlib.AsyncExitStack to pass config in and
# reduce duplication
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager for FastAPI to handle startup and shutdown events."""

    # keep for now, we need to set a "global redis" for plugins to use
    logger.info("tangram api started with plugin support")
    yield


def create_app(
    config: Config,
    loaded_plugins: Iterable[tuple[DistName, Plugin]],
) -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.state.config = config
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


async def run_channel_service(config: Config) -> None:
    from ._channel import ChannelConfig, init_logging, run

    init_logging("debug")

    rust_config = ChannelConfig(
        host=config.channel.host,
        port=config.channel.port,
        redis_url=config.core.redis_url,
        jwt_secret=config.channel.jwt_secret,
        jwt_expiration_secs=config.channel.jwt_expiration_secs,
    )
    await run(rust_config)


async def run_services(
    config: Config,
    loaded_plugins: Iterable[tuple[DistName, Plugin]],
) -> AsyncGenerator[asyncio.Task[None], None]:
    yield asyncio.create_task(run_channel_service(config))

    for dist_name, plugin in loaded_plugins:
        for _, service_func in sorted(
            plugin.services, key=lambda s: (s[0], s[1].__name__)
        ):
            yield asyncio.create_task(service_func(config))
            logger.info(f"started service from plugin: {dist_name}")
