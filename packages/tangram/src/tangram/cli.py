import asyncio
import importlib.resources
import logging
from importlib.abc import Traversable
from pathlib import Path
from typing import Annotated

import typer
import uvicorn
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .backend import create_app
from .config import TangramConfig, parse_config

app = typer.Typer()
logger = logging.getLogger(__name__)


async def run_channel_service(config: TangramConfig):
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


async def run_server(
    config: TangramConfig, host: str, port: int, static_dir: Traversable
):
    app_instance = create_app()
    app_instance.state.config = config

    frontend_plugins = []
    for plugin_name in config.core.plugins:
        try:
            plugin_dist = importlib.resources.files(plugin_name) / "dist-frontend"
        except ModuleNotFoundError:
            logger.warning(f"module not found for `{plugin_name}`.")
            continue
        if plugin_dist.is_dir():
            app_instance.mount(
                f"/plugins/{plugin_name}",
                StaticFiles(directory=str(plugin_dist)),
                name=plugin_name,
            )
            frontend_plugins.append(plugin_name)

    @app_instance.get("/manifest.json")
    async def get_manifest():
        return JSONResponse(content={"plugins": frontend_plugins})

    app_instance.mount(
        "/", StaticFiles(directory=str(static_dir), html=True), name="core"
    )

    server_config = uvicorn.Config(app_instance, host=host, port=port, log_level="info")
    server = uvicorn.Server(server_config)
    await server.serve()


async def start_services(config: TangramConfig):
    core_dist = importlib.resources.files("tangram") / "dist-frontend"

    api_server_task = asyncio.create_task(
        run_server(config, config.server.host, config.server.port, core_dist)
    )
    channel_service_task = asyncio.create_task(run_channel_service(config))

    await asyncio.gather(api_server_task, channel_service_task)


@app.command()
def serve(
    config: Annotated[Path, typer.Option(help="Path to the tangram.toml config file.")],
):
    """Serves the core tangram frontend and backend services."""
    if not config.is_file():
        raise typer.Exit(f"config file not found: {config}")

    try:
        asyncio.run(start_services(parse_config(config)))
    except KeyboardInterrupt:
        logger.info("shutting down services.")


@app.command()
def develop():
    raise SystemExit


if __name__ == "__main__":
    app()
