from __future__ import annotations

import importlib.metadata
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("tangram")


def load_plugins(app: FastAPI) -> None:
    """Discover and load all plugins via entry points."""
    app.state.background_tasks = set()
    for entry_point in importlib.metadata.entry_points(group="tangram.plugins"):
        try:
            plugin_registration_func = entry_point.load()
            plugin_registration_func(app)
            log.info(f"registered plugin: {entry_point.name}")
        except Exception as e:
            log.error(f"failed to load plugin {entry_point.name}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager for FastAPI to handle startup and shutdown events."""

    load_plugins(app)
    log.info("tangram api started with plugin support")
    yield


def create_app(static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    if static_dir and static_dir.is_dir():  # for use in frontend
        app.mount(
            "/",
            StaticFiles(directory=static_dir, html=True),
            name="static",
        )
    return app


app = create_app()  # TODO: get rid of this
