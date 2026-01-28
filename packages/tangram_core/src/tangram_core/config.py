from __future__ import annotations

import json
import os
import sys
import urllib.parse
from dataclasses import dataclass, field
from os import PathLike
from pathlib import Path
from typing import Any, Literal, Protocol, TypeAlias, runtime_checkable


def default_config_file() -> Path:
    import platformdirs

    if (xdg_config := os.environ.get("XDG_CONFIG_HOME")) is not None:
        config_dir = Path(xdg_config) / "tangram"
    else:
        config_dir = Path(platformdirs.user_config_dir(appname="tangram"))
    if not config_dir.exists():
        config_dir.mkdir(parents=True, exist_ok=True)

    return Path(config_dir) / "tangram.toml"


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


StyleName: TypeAlias = str


@dataclass
class StyleSpecification:
    name: StyleName | None = None
    sources: dict[str, UrlConfig] | None = None
    glyphs: str = "https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf"
    layers: list[Any] | None = None
    version: Literal[8] = 8


Url: TypeAlias = str


@dataclass
class MapConfig:
    # users can specify local path in config file but it will be resolved in from_file
    # and so the stored type cannot be Path
    style: Url | StyleName | StyleSpecification = (
        "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
    )
    styles: list[Url | StyleSpecification] = field(default_factory=list)
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
    enable_3d: bool = False


@dataclass
class ThemeDefinition:
    name: str
    background_color: str
    foreground_color: str
    surface_color: str
    border_color: str
    hover_color: str
    accent1: str
    accent1_foreground: str
    accent2: str
    accent2_foreground: str
    muted_color: str


@dataclass
class AdaptiveTheme:
    light: str = "light"
    dark: str = "dark"


@dataclass
class CoreConfig:
    redis_url: str = "redis://127.0.0.1:6379"
    plugins: list[str] = field(default_factory=list)
    log_level: str = "INFO"
    theme: str | AdaptiveTheme = field(default_factory=AdaptiveTheme)


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


# do not use with dataclasses yet: it probably wont work for pydantic.TypeAdapter
# stolen from typeshed. maybe we should apply it everywhere
StrOrPathLike = str | PathLike[str]
IntoConfig: TypeAlias = "Config | StrOrPathLike"


@dataclass
class Config:
    core: CoreConfig = field(default_factory=CoreConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    channel: ChannelConfig = field(default_factory=ChannelConfig)
    map: MapConfig = field(default_factory=MapConfig)
    plugins: dict[str, Any] = field(default_factory=dict)
    """Mapping of plugin name to plugin-specific config."""
    themes: list[ThemeDefinition] = field(default_factory=list)
    cache: CacheConfig = field(default_factory=CacheConfig)

    @classmethod
    def from_file(cls, config_path: StrOrPathLike) -> Config:
        if sys.version_info < (3, 11):
            import tomli as tomllib
        else:
            import tomllib
        from pydantic import TypeAdapter

        with open(config_path, "rb") as f:
            cfg_data = tomllib.load(f)

        base_dir = Path(config_path).parent
        map = cfg_data.setdefault("map", {})
        if (s := map.get("style", None)) is not None:
            map["style"] = try_resolve_local_style(base_dir, s, allow_style_name=True)
        map["styles"] = [
            try_resolve_local_style(base_dir, style, allow_style_name=False)
            for style in map.get("styles", [])
        ]
        config_adapter = TypeAdapter(cls)
        config = config_adapter.validate_python(cfg_data)
        return config


def try_resolve_local_style(
    base_dir: Path,
    style: Url | StyleName | StyleSpecification,
    *,
    allow_style_name: bool,
) -> Url | StyleSpecification:
    if isinstance(style, str):
        scheme = urllib.parse.urlparse(style).scheme
        if scheme in ("http", "https"):
            return style
        if (p := (base_dir / style).resolve()).is_file():
            with open(p, "rb") as f:
                return json.load(f)
        if not allow_style_name:
            raise ValueError(f"expected '{style}' to be a valid URL or file path")
    return style


@dataclass(frozen=True)
class ExposeField:
    """Marker class for typing.Annotated to expose fields to the frontend."""


#
# when served over reverse proxies, we do not want to simply expose the entire
# backend config to the frontend. the following structs are used to selectively
# expose a subset of the config to the frontend.
#


@dataclass
class FrontendChannelConfig:
    url: str


@dataclass
class FrontendThemeConfig:
    active: str | AdaptiveTheme
    definitions: list[ThemeDefinition]


@dataclass
class FrontendConfig:
    channel: FrontendChannelConfig
    map: MapConfig
    theme: FrontendThemeConfig
