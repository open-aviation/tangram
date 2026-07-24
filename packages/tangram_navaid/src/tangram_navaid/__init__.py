from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

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


@dataclass(frozen=True, slots=True)
class TangramNavaidConfig:
    """Configuration for the navaid, fix, and Field 15 search plugin."""

    ddr_archive_url: str = _DEFAULT_DDR_ARCHIVE_URL
    """EUROCONTROL DDR archive URL cached and served by the backend."""

    path_cache: Path = Path(platformdirs.user_cache_dir("tangram_navaid"))
    """Directory used for cached navigation archives."""

    traffic_js_url: str | None = None
    """traffic.js ESM module URL. Defaults to the pinned public CDN build."""

    enable_faa: bool = False
    """Attach the FAA ArcGIS navigation source in the browser."""


@dataclass(frozen=True, slots=True)
class TangramNavaidFrontendConfig:
    traffic_js_url: str | None = None
    enable_faa: bool = False


def _into_frontend(config: TangramNavaidConfig) -> TangramNavaidFrontendConfig:
    return TangramNavaidFrontendConfig(
        traffic_js_url=config.traffic_js_url,
        enable_faa=config.enable_faa,
    )


_config_adapter = TypeAdapter(TangramNavaidConfig)
_download_lock = asyncio.Lock()


def _archive_path(url: str, path_cache: Path) -> Path:
    digest = hashlib.sha256(url.encode()).hexdigest()
    return path_cache / f"ddr-{digest}.zip"


async def _ensure_ddr_archive(
    client: httpx.AsyncClient, url: str, path_cache: Path
) -> Path:
    destination = _archive_path(url, path_cache)
    if destination.exists():
        return destination

    async with _download_lock:
        if destination.exists():
            return destination

        path_cache.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(".zip.part")
        partial.unlink(missing_ok=True)
        log.info("downloading EUROCONTROL DDR archive from %s", url)
        try:
            async with client.stream("GET", url, follow_redirects=True) as response:
                response.raise_for_status()
                with partial.open("wb") as file:
                    async for chunk in response.aiter_bytes():
                        file.write(chunk)
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)

    return destination


@_router.get("/ddr", response_class=FileResponse)
async def _get_ddr_archive(state: tangram_core.InjectBackendState) -> FileResponse:
    config = _config_adapter.validate_python(
        state.config.plugins.get("tangram_navaid", {})
    )
    destination = await _ensure_ddr_archive(
        state.http_client,
        config.ddr_archive_url,
        config.path_cache,
    )
    return FileResponse(destination, media_type="application/zip")


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[_router],
    config_class=TangramNavaidConfig,
    frontend_config_class=TangramNavaidFrontendConfig,
    into_frontend_config_function=_into_frontend,
)
