from __future__ import annotations

import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncGenerator, Literal, cast

import httpx
import platformdirs
import tangram_core
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import TypeAdapter

log = logging.getLogger(__name__)
_router = APIRouter(prefix="/navaid", tags=["navaid"])

_DEFAULT_DDR_ARCHIVE_URL = (
    "https://static.observableusercontent.com/files/"
    "a4f0c6bc8c28bf890997ae7abb5a4dece65ef5e74596b07a307c9d589f860428"
    "b582cb1341cafaaa5b7cddf6d03fef257f2ecefe3278262d56df2ba7d58a9a52"
)
_XPLANE_DATA_REVISION = "aee9ba062051b6b5619b5c486be2b6e24f66a1fb"
_XPLANE_BASE_URL = (
    "https://raw.githubusercontent.com/xoolive/traffic/"
    f"{_XPLANE_DATA_REVISION}/src/traffic/data/navdata"
)


@dataclass(frozen=True, slots=True)
class XplaneAssets:
    """Remote X-Plane navigation datasets cached by the backend."""

    nav_url: str = f"{_XPLANE_BASE_URL}/earth_nav.dat"
    fix_url: str = f"{_XPLANE_BASE_URL}/earth_fix.dat"
    awy_url: str = f"{_XPLANE_BASE_URL}/earth_awy.dat"


@dataclass(frozen=True, slots=True)
class TangramNavaidConfig:
    """Configuration for the navaid, fix, and Field 15 search plugin."""

    ddr_archive_url: str = _DEFAULT_DDR_ARCHIVE_URL
    """EUROCONTROL DDR archive URL cached and served by the backend."""
    xplane: XplaneAssets = field(default_factory=XplaneAssets)
    """X-Plane dataset URLs cached and served by the backend."""
    path_cache: Path = Path(platformdirs.user_cache_dir("tangram_navaid"))
    """Directory used for cached navigation data."""
    enable_faa: bool = False
    """Attach the FAA ArcGIS navigation source in the browser."""


@dataclass(frozen=True, slots=True)
class TangramNavaidFrontendConfig:
    enable_faa: bool = False


@dataclass(frozen=True, slots=True)
class _NavaidState:
    config: TangramNavaidConfig


@dataclass(frozen=True, slots=True)
class _RemoteFile:
    cache_name: str
    url: str
    suffix: str
    media_type: str


def _into_frontend(config: TangramNavaidConfig) -> TangramNavaidFrontendConfig:
    return TangramNavaidFrontendConfig(enable_faa=config.enable_faa)


_config_adapter = TypeAdapter(TangramNavaidConfig)
_download_locks: dict[Path, asyncio.Lock] = {}


def _cache_path(source: _RemoteFile, path_cache: Path) -> Path:
    digest = hashlib.sha256(source.url.encode()).hexdigest()
    return path_cache.expanduser() / f"{source.cache_name}-{digest}{source.suffix}"


async def _ensure_cached_file(
    client: httpx.AsyncClient,
    source: _RemoteFile,
    path_cache: Path,
) -> Path:
    destination = _cache_path(source, path_cache)
    if destination.exists():
        return destination

    lock = _download_locks.setdefault(destination, asyncio.Lock())
    async with lock:
        if destination.exists():
            return destination

        path_cache.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(f"{destination.suffix}.part")
        partial.unlink(missing_ok=True)
        log.info("downloading navigation data from %s", source.url)
        try:
            async with client.stream(
                "GET", source.url, follow_redirects=True
            ) as response:
                response.raise_for_status()
                with partial.open("wb") as file:
                    async for chunk in response.aiter_bytes():
                        file.write(chunk)
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)

    return destination


@asynccontextmanager
async def _lifespan(
    state: tangram_core.BackendState,
) -> AsyncGenerator[None, None]:
    # TODO: core should expose its validated plugin config to lifespans. Until
    # then, retain one plugin-local instance instead of validating every request.
    config = _config_adapter.validate_python(
        state.config.plugins.get("tangram_navaid", {})
    )
    setattr(state, "navaid_state", _NavaidState(config=config))
    try:
        yield
    finally:
        delattr(state, "navaid_state")


def _get_navaid_state(
    state: tangram_core.InjectBackendState,
) -> _NavaidState:
    return cast(_NavaidState, getattr(state, "navaid_state"))


def _plugin_config(state: tangram_core.InjectBackendState) -> TangramNavaidConfig:
    return _get_navaid_state(state).config


@_router.get("/ddr", response_class=FileResponse)
async def _get_ddr_archive(state: tangram_core.InjectBackendState) -> FileResponse:
    config = _plugin_config(state)
    source = _RemoteFile(
        cache_name="ddr",
        url=config.ddr_archive_url,
        suffix=".zip",
        media_type="application/zip",
    )
    destination = await _ensure_cached_file(
        state.http_client,
        source,
        config.path_cache,
    )
    return FileResponse(destination, media_type=source.media_type)


def _xplane_source(
    assets: XplaneAssets,
    dataset: Literal["nav", "fix", "awy"],
) -> _RemoteFile:
    if dataset == "nav":
        return _RemoteFile("earth-nav", assets.nav_url, ".dat", "text/plain")
    if dataset == "fix":
        return _RemoteFile("earth-fix", assets.fix_url, ".dat", "text/plain")
    return _RemoteFile("earth-awy", assets.awy_url, ".dat", "text/plain")


@_router.get("/xplane/{dataset}", response_class=FileResponse)
async def _get_xplane_data(
    dataset: Literal["nav", "fix", "awy"],
    state: tangram_core.InjectBackendState,
) -> FileResponse:
    config = _plugin_config(state)
    source = _xplane_source(config.xplane, dataset)
    destination = await _ensure_cached_file(
        state.http_client,
        source,
        config.path_cache,
    )
    return FileResponse(destination, media_type=source.media_type)


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[_router],
    config_class=TangramNavaidConfig,
    frontend_config_class=TangramNavaidFrontendConfig,
    into_frontend_config_function=_into_frontend,
    lifespan=_lifespan,
)
