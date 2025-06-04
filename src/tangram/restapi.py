from __future__ import annotations

import importlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI

from tangram.common import rs1090

log = logging.getLogger("tangram")
log.setLevel(logging.DEBUG)

file_handler = logging.FileHandler("/tmp/tangram/tangram.log")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
log.addHandler(file_handler)

# Add a console handler for stdout
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
log.addHandler(console_handler)

jet1090_restful_client = rs1090.Rs1090Client()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager for FastAPI to handle startup and shutdown events."""

    load_plugins(app)
    log.info("Tangram API started with plugin support")
    yield


app = FastAPI(lifespan=lifespan)


def load_plugins(app: FastAPI) -> None:
    """Discover and load all plugins from the plugin directory."""

    plugins = list((Path(__file__).parent / "plugins").glob("*"))
    if plugin_dir := os.environ.get("TANGRAM_PLUGIN_DIR"):
        # TODO not functional yet, the import command needs to be adjusted
        plugin_path = Path(plugin_dir)
        if not plugin_path.exists():
            log.warning(f"Plugin directory not found: {plugin_path}")
        plugins.extend(list(plugin_path.glob("*")))

    for entry in plugins:
        if entry.is_dir() and not entry.name.startswith("_"):
            try:
                # Import the plugin module
                plugin_module = importlib.import_module(f"tangram.plugins.{entry.name}")

                # Check if it has a register_plugin function
                if hasattr(plugin_module, "register_plugin"):
                    # Register the plugin
                    plugin_module.register_plugin(app)
                    log.info(f"Registered plugin: {entry.name}")
            except Exception as e:
                log.error(f"Failed to load plugin {entry.name}: {e}")


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]
