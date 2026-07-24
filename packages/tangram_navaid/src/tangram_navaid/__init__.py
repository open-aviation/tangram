from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncGenerator, cast

import tangram_core
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import TypeAdapter

from .cache import (
    CacheOperation,
    CacheStatus,
    FaaDataset,
    TangramNavaidConfig,
    XplaneDataset,
    cache_status,
    ddr_source,
    ensure,
    faa_source,
    prewarm,
    prewarm_faa,
    refresh_faa,
    xplane_source,
)

_router = APIRouter(prefix="/navaid", tags=["navaid"])
_config_adapter = TypeAdapter(TangramNavaidConfig)


@dataclass(frozen=True, slots=True)
class TangramNavaidFrontendConfig:
    enable_faa: bool = False


@dataclass(frozen=True, slots=True)
class _NavaidState:
    config: TangramNavaidConfig


def _into_frontend(config: TangramNavaidConfig) -> TangramNavaidFrontendConfig:
    return TangramNavaidFrontendConfig(enable_faa=config.enable_faa)


@asynccontextmanager
async def _lifespan(
    state: tangram_core.BackendState,
) -> AsyncGenerator[None, None]:
    # TODO: core should expose its validated plugin config to lifespans.
    config = _config_adapter.validate_python(
        state.config.plugins.get("tangram_navaid", {})
    )
    setattr(state, "navaid_state", _NavaidState(config))
    if config.enable_faa:
        await prewarm_faa(state.http_client, config)
    try:
        yield
    finally:
        delattr(state, "navaid_state")


def _config(state: tangram_core.InjectBackendState) -> TangramNavaidConfig:
    navaid_state = cast(_NavaidState, getattr(state, "navaid_state"))
    return navaid_state.config


@_router.get("/ddr", response_class=FileResponse)
async def _get_ddr_archive(state: tangram_core.InjectBackendState) -> FileResponse:
    config = _config(state)
    source = ddr_source(config)
    path = await ensure(state.http_client, source, config.path_cache)
    return FileResponse(path, media_type=source.media_type)


@_router.get("/xplane/{dataset}", response_class=FileResponse)
async def _get_xplane_data(
    dataset: XplaneDataset,
    state: tangram_core.InjectBackendState,
) -> FileResponse:
    config = _config(state)
    source = xplane_source(config, dataset)
    path = await ensure(state.http_client, source, config.path_cache)
    return FileResponse(path, media_type=source.media_type)


@_router.get("/faa/{dataset}", response_class=FileResponse)
async def _get_faa_data(
    dataset: FaaDataset,
    state: tangram_core.InjectBackendState,
) -> FileResponse:
    config = _config(state)
    source = faa_source(config, dataset)
    path = await ensure(state.http_client, source, config.path_cache)
    return FileResponse(path, media_type=source.media_type)


# currently unused, TODO implement a way to manage the cache on the frontend


@_router.get("/cache/status")
async def _get_cache_status(
    state: tangram_core.InjectBackendState,
) -> CacheStatus:
    return cache_status(_config(state))


@_router.post("/cache/prewarm")
async def _prewarm_cache(
    state: tangram_core.InjectBackendState,
) -> CacheOperation:
    return await prewarm(state.http_client, _config(state))


@_router.post("/cache/refresh/faa")
async def _refresh_faa_cache(
    state: tangram_core.InjectBackendState,
) -> CacheOperation:
    return await refresh_faa(state.http_client, _config(state))


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[_router],
    config_class=TangramNavaidConfig,
    frontend_config_class=TangramNavaidFrontendConfig,
    into_frontend_config_function=_into_frontend,
    lifespan=_lifespan,
)
