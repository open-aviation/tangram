from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


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
    zoom: int = 4
    pitch: float = 0
    bearing: float = 0
    lang: str = "en"


@dataclass
class CoreConfig:
    redis_url: str = "redis://127.0.0.1:6379"
    plugins: list[str] = field(default_factory=list)
    log_level: str = "INFO"


@dataclass
class CacheEntry:
    # origin url (if None, just serve the local file)
    origin: str | None = None
    # local path to cache the file
    local_path: Path | None = None
    # how to serve the file
    serve_route: str = ""
    # media type for the served file
    media_type: str = "application/octet-stream"


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


@dataclass
class FrontendChannelConfig:
    url: str


@dataclass
class FrontendConfig:
    channel: FrontendChannelConfig
    map: MapConfig
