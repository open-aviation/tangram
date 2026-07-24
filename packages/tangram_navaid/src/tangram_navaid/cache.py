from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Literal, TypedDict

import httpx
import platformdirs

log = logging.getLogger(__name__)

FaaDataset = Literal["airports", "routes", "points", "navaids"]
XplaneDataset = Literal["nav", "fix", "awy"]
SourceGroup = Literal["ddr", "xplane", "faa"]

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
_FAA_ARCGIS_BASE_URL = "https://opendata.arcgis.com/datasets"
_FAA_DATASET_IDS: dict[FaaDataset, str] = {
    "airports": "e747ab91a11045e8b3f8a3efd093d3b5_0",
    "routes": "acf64966af5f48a1a40fdbcb31238ba7_0",
    "points": "861043a88ff4486c97c3789e7dcdccc6_0",
    "navaids": "c9254c171b6741d3a5e494860761443a_0",
}


@dataclass(frozen=True, slots=True)
class XplaneAssets:
    """Remote X-Plane navigation datasets cached by the backend."""

    nav_url: str = f"{_XPLANE_BASE_URL}/earth_nav.dat"
    fix_url: str = f"{_XPLANE_BASE_URL}/earth_fix.dat"
    awy_url: str = f"{_XPLANE_BASE_URL}/earth_awy.dat"


@dataclass(frozen=True, slots=True)
class FaaAssets:
    """Remote FAA ArcGIS collections cached by the backend."""

    airports_url: str = f"{_FAA_ARCGIS_BASE_URL}/{_FAA_DATASET_IDS['airports']}.geojson"
    routes_url: str = f"{_FAA_ARCGIS_BASE_URL}/{_FAA_DATASET_IDS['routes']}.geojson"
    points_url: str = f"{_FAA_ARCGIS_BASE_URL}/{_FAA_DATASET_IDS['points']}.geojson"
    navaids_url: str = f"{_FAA_ARCGIS_BASE_URL}/{_FAA_DATASET_IDS['navaids']}.geojson"


@dataclass(frozen=True, slots=True)
class TangramNavaidConfig:
    """Configuration for the navaid, fix, and Field 15 search plugin."""

    path_cache: Path = Path(platformdirs.user_cache_dir("tangram_navaid"))
    """Directory used for cached navigation data."""
    ddr_archive_url: str = _DEFAULT_DDR_ARCHIVE_URL
    """EUROCONTROL DDR archive URL cached and served by the backend."""
    xplane: XplaneAssets = field(default_factory=XplaneAssets)
    """X-Plane dataset URLs cached and served by the backend."""
    enable_faa: bool = False
    """Attach the cached FAA navigation source in the browser."""
    faa: FaaAssets = field(default_factory=FaaAssets)
    """FAA ArcGIS collection URLs cached and served by the backend."""


@dataclass(frozen=True, slots=True)
class Source:
    name: str
    group: SourceGroup
    url: str
    suffix: str
    media_type: str
    required: bool = True


class CacheEntry(TypedDict):
    name: str
    group: SourceGroup
    required: bool
    ready: bool
    source_url: str
    path: str
    size_bytes: int | None


class CacheStatus(TypedDict):
    ready: bool
    entries: list[CacheEntry]


class CacheOperation(TypedDict):
    status: CacheStatus
    updated: list[str]
    unchanged: list[str]


_download_locks: dict[Path, asyncio.Lock] = {}


def ddr_source(config: TangramNavaidConfig) -> Source:
    return Source(
        "ddr",
        "ddr",
        config.ddr_archive_url,
        ".zip",
        "application/zip",
    )


def xplane_source(config: TangramNavaidConfig, dataset: XplaneDataset) -> Source:
    if dataset == "nav":
        url = config.xplane.nav_url
    elif dataset == "fix":
        url = config.xplane.fix_url
    else:
        url = config.xplane.awy_url
    return Source(f"xplane-{dataset}", "xplane", url, ".dat", "text/plain")


def faa_source(config: TangramNavaidConfig, dataset: FaaDataset) -> Source:
    if dataset == "airports":
        url = config.faa.airports_url
    elif dataset == "routes":
        url = config.faa.routes_url
    elif dataset == "points":
        url = config.faa.points_url
    else:
        url = config.faa.navaids_url
    return Source(
        f"faa-{dataset}",
        "faa",
        url,
        ".geojson",
        "application/geo+json",
        required=config.enable_faa,
    )


def iter_sources(config: TangramNavaidConfig) -> Iterator[Source]:
    yield ddr_source(config)
    yield from (xplane_source(config, dataset) for dataset in ("nav", "fix", "awy"))
    yield from (
        faa_source(config, dataset)
        for dataset in ("airports", "routes", "points", "navaids")
    )


def cache_path(source: Source, path_cache: Path) -> Path:
    digest = hashlib.sha256(source.url.encode()).hexdigest()
    return path_cache.expanduser() / f"{source.name}-{digest}{source.suffix}"


async def _download(
    client: httpx.AsyncClient,
    source: Source,
    destination: Path,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(f"{destination.suffix}.part")
    try:
        async with client.stream("GET", source.url, follow_redirects=True) as response:
            response.raise_for_status()
            with partial.open("wb") as file:
                async for chunk in response.aiter_bytes():
                    file.write(chunk)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


async def ensure(
    client: httpx.AsyncClient,
    source: Source,
    path_cache: Path,
) -> Path:
    destination = cache_path(source, path_cache)
    if destination.exists():
        return destination

    lock = _download_locks.setdefault(destination, asyncio.Lock())
    async with lock:
        if not destination.exists():
            await _download(client, source, destination)
    return destination


def iter_cache_entries(config: TangramNavaidConfig) -> Iterator[CacheEntry]:
    for source in iter_sources(config):
        destination = cache_path(source, config.path_cache)
        ready = destination.exists()
        yield CacheEntry(
            name=source.name,
            group=source.group,
            required=source.required,
            ready=ready,
            source_url=source.url,
            path=str(destination),
            size_bytes=destination.stat().st_size if ready else None,
        )


def cache_status(config: TangramNavaidConfig) -> CacheStatus:
    entries = list(iter_cache_entries(config))
    return CacheStatus(
        ready=all(entry["ready"] for entry in entries if entry["required"]),
        entries=entries,
    )


async def prewarm(
    client: httpx.AsyncClient,
    config: TangramNavaidConfig,
) -> CacheOperation:
    required = tuple(source for source in iter_sources(config) if source.required)
    cached = {
        source.name
        for source in required
        if cache_path(source, config.path_cache).exists()
    }
    await asyncio.gather(
        *(ensure(client, source, config.path_cache) for source in required)
    )
    return CacheOperation(
        status=cache_status(config),
        updated=[source.name for source in required if source.name not in cached],
        unchanged=[source.name for source in required if source.name in cached],
    )


async def prewarm_faa(
    client: httpx.AsyncClient,
    config: TangramNavaidConfig,
) -> None:
    faa = tuple(source for source in iter_sources(config) if source.group == "faa")
    results = await asyncio.gather(
        *(ensure(client, source, config.path_cache) for source in faa),
        return_exceptions=True,
    )
    for source, result in zip(faa, results, strict=True):
        if isinstance(result, Exception):
            log.warning("could not cache %s: %s", source.name, result)


async def refresh_faa(
    client: httpx.AsyncClient,
    config: TangramNavaidConfig,
) -> CacheOperation:
    faa = tuple(
        faa_source(config, dataset)
        for dataset in ("airports", "routes", "points", "navaids")
    )

    async def refresh(source: Source) -> None:
        destination = cache_path(source, config.path_cache)
        async with _download_locks.setdefault(destination, asyncio.Lock()):
            # Assume FAA ArcGIS returned the requested collection; traffic.js parses it.
            await _download(client, source, destination)

    await asyncio.gather(*(refresh(source) for source in faa))
    return CacheOperation(
        status=cache_status(config),
        updated=[source.name for source in faa],
        unchanged=[],
    )
