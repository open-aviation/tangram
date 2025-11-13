from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


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
    jwt_secret: str = "secret"
    jwt_expiration_secs: int = 315360000  # 10 years
    id_length: int = 8
    python_tracing_subscriber: bool = False


@dataclass  # TODO: resolve the path to the style.json
class StyleConfig:
    path: str


@dataclass
class MapConfig:
    style: str | StyleConfig = (
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


@dataclass
class CoreConfig:
    redis_url: str = "redis://127.0.0.1:6379"
    plugins: list[str] = field(default_factory=list)
    log_level: str = "INFO"


@dataclass
class Config:
    core: CoreConfig = field(default_factory=CoreConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    channel: ChannelConfig = field(default_factory=ChannelConfig)
    map: MapConfig = field(default_factory=MapConfig)
    plugins: dict[str, Any] = field(default_factory=dict)

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
    host: str
    port: int


@dataclass
class FrontendConfig:
    channel: FrontendChannelConfig
    map: MapConfig
