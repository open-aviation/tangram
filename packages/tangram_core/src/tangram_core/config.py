from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, runtime_checkable


@runtime_checkable
class HasTopbarUiConfig(Protocol):
    topbar_order: int


@runtime_checkable
class HasSidebarUiConfig(Protocol):
    sidebar_order: int


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 2346


@dataclass
class ChannelConfig:
    # TODO: we should make it clear that host:port is for the *backend* to
    # listen on, and not to be confused with the frontend.
    host: str = "127.0.0.1"
    port: int = 2347
    public_url: str | None = None
    jwt_secret: str = "secret"
    jwt_expiration_secs: int = 315360000  # 10 years
    id_length: int = 8


@dataclass
class UrlConfig:
    url: str
    type: str = "vector"


@dataclass
class SourceSpecification:
    carto: UrlConfig | None = None
    protomaps: UrlConfig | None = None


@dataclass
class StyleSpecification:
    sources: SourceSpecification | None = None
    glyphs: str = "https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf"
    layers: list[Any] | None = None
    version: Literal[8] = 8


@dataclass
class MapConfig:
    style: str | StyleSpecification = (
        "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
    )
    attribution: str = (
        '&copy; <a href="https://www.openstreetmap.org/copyright">'
        "OpenStreetMap</a> contributors &copy; "
        '<a href="https://carto.com/attributions">CARTO</a>'
    )
    center_lat: float = 48.0
    center_lon: float = 7.0
    zoom: float = 4
    pitch: float = 0
    bearing: float = 0
    lang: str = "en"
    min_zoom: float = 0
    max_zoom: float = 24
    max_pitch: float = 70
    allow_pitch: bool = True
    allow_bearing: bool = True


@dataclass
class CoreConfig:
    redis_url: str = "redis://127.0.0.1:6379"
    plugins: list[str] = field(default_factory=list)
    log_level: str = "INFO"


@dataclass
class CacheEntry:
    origin: str | None = None
    """Origin URL. If None, the local file is served directly."""
    local_path: Path | None = None
    """Local path to cache the file."""
    serve_route: str = ""
    """Where to serve the file in FastAPI."""
    media_type: str = "application/octet-stream"
    """Media type for the response."""


@dataclass
class CacheConfig:
    entries: list[CacheEntry] = field(default_factory=list)


@dataclass
class Config:
    core: CoreConfig = field(default_factory=CoreConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    channel: ChannelConfig = field(default_factory=ChannelConfig)
    map: MapConfig = field(default_factory=MapConfig)
    plugins: dict[str, Any] = field(default_factory=dict)
    cache: CacheConfig = field(default_factory=CacheConfig)

    @classmethod
    def from_file(cls, config_path: Path) -> Config:
        if sys.version_info < (3, 11):
            import tomli as tomllib
        else:
            import tomllib
        from pydantic import TypeAdapter

        with open(config_path, "rb") as f:
            cfg_data = tomllib.load(f)

        config_adapter = TypeAdapter(cls)
        config = config_adapter.validate_python(cfg_data)
        return config


#
# when served over reverse proxies, we do not want to simply expose the entire
# backend config to the frontend. the following structs are used to selectively
# expose a subset of the config to the frontend.
#


@dataclass
class FrontendChannelConfig:
    url: str


@dataclass
class FrontendConfig:
    channel: FrontendChannelConfig
    map: MapConfig
