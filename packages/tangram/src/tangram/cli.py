import importlib.resources
import logging
import sys
from pathlib import Path
from typing import Annotated

import typer
import uvicorn
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .backend import create_app

if sys.version_info < (3, 11):
    import tomli as tomllib
else:
    import tomllib


app = typer.Typer()
logger = logging.getLogger(__name__)


@app.command()
def serve(
    config: Annotated[Path, typer.Option(help="Path to the tangram.toml config file.")],
    host: str = "127.0.0.1",
    port: int = 8000,
):
    """Serves the core tangram frontend with dynamically loaded plugins."""
    if not config.is_file():
        raise typer.Exit(f"Config file not found: {config}")

    with open(config, "rb") as f:
        cfg = tomllib.load(f)

    app_instance = create_app()

    plugins = cfg.get("core", {}).get("plugins", [])
    frontend_plugins = []
    for plugin_name in plugins:
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

    manifest = {"plugins": frontend_plugins}

    @app_instance.get("/manifest.json")
    async def get_manifest():
        return JSONResponse(content=manifest)

    core_dist = importlib.resources.files("tangram") / "dist-frontend"
    app_instance.mount(
        "/", StaticFiles(directory=str(core_dist), html=True), name="core"
    )

    uvicorn.run(app_instance, host=host, port=port)


@app.command()
def build():
    raise NotImplementedError


if __name__ == "__main__":
    app()
