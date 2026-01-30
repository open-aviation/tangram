from __future__ import annotations

import json
import os
import sys
import urllib.parse
from dataclasses import dataclass, field
from os import PathLike
from pathlib import Path
from typing import (
    TYPE_CHECKING,
    Annotated,
    Any,
    ClassVar,
    Literal,
    Protocol,
    TypeAlias,
    TypedDict,
    runtime_checkable,
)

from annotated_types import Ge, Le

# while tangram bundles pydantic and supports pydantic.BaseModel for defining configs,
# we still want to support alternative ways of defining configs, such as stdlib
# dataclasses and typeddict. so we avoid direct pydantic imports in this file.
if TYPE_CHECKING:
    from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler, TypeAdapter
    from pydantic.json_schema import JsonSchemaValue
    from pydantic_core import CoreSchema


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
    version: int = 8


Url: TypeAlias = str


def default_styles() -> list[Url | StyleSpecification]:
    return [
        "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
        "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    ]


@dataclass
class MapConfig:
    # users can specify local path in config file but it will be resolved in from_file
    # and so the stored type cannot be Path
    style: Annotated[
        Url | StyleName | StyleSpecification, FrontendMutable(widget="map-settings")
    ] = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
    styles: Annotated[
        list[Url | StyleSpecification], FrontendMutable(widget="map-settings")
    ] = field(default_factory=default_styles)
    center_lat: Annotated[float, Ge(-90), Le(90), FrontendMutable()] = 48.0
    center_lon: Annotated[float, Ge(-180), Le(180), FrontendMutable()] = 7.0
    zoom: Annotated[float, Ge(0), Le(24), FrontendMutable()] = 4
    pitch: Annotated[float, Ge(0), Le(85), FrontendMutable()] = 0
    bearing: Annotated[float, Ge(-180), Le(180), FrontendMutable()] = 0
    lang: Annotated[str, FrontendMutable()] = "en"
    min_zoom: Annotated[float, Ge(0), Le(24), FrontendMutable()] = 0
    max_zoom: Annotated[float, Ge(0), Le(24), FrontendMutable()] = 24
    max_pitch: Annotated[float, Ge(0), Le(85), FrontendMutable()] = 70
    allow_pitch: Annotated[bool, FrontendMutable()] = True
    allow_bearing: Annotated[bool, FrontendMutable()] = True
    layers_visibility: Annotated[
        dict[str, bool] | None, FrontendMutable(widget="map-settings")
    ] = None


@dataclass
class ThemeDefinition:
    name: str
    background: Annotated[str, FrontendMutable(kind="color")]
    foreground: Annotated[str, FrontendMutable(kind="color")]
    surface: Annotated[str, FrontendMutable(kind="color")]
    border: Annotated[str, FrontendMutable(kind="color")]
    hover: Annotated[str, FrontendMutable(kind="color")]
    accent1: Annotated[str, FrontendMutable(kind="color")]
    accent1_foreground: Annotated[str, FrontendMutable(kind="color")]
    accent2: Annotated[str, FrontendMutable(kind="color")]
    accent2_foreground: Annotated[str, FrontendMutable(kind="color")]
    muted: Annotated[str, FrontendMutable(kind="color")]
    error: Annotated[str, FrontendMutable(kind="color")]


@dataclass
class AdaptiveTheme:
    light: Annotated[str, FrontendMutable()] = "light"
    dark: Annotated[str, FrontendMutable()] = "dark"


@dataclass
class CoreConfig:
    redis_url: Annotated[str, BackendInternal()] = "redis://127.0.0.1:6379"
    plugins: Annotated[list[str], BackendInternal()] = field(default_factory=list)
    log_level: Annotated[str, BackendInternal()] = "INFO"
    theme: Annotated[str | AdaptiveTheme, FrontendMutable(widget="theme-settings")] = (
        field(default_factory=AdaptiveTheme)
    )
    themes: Annotated[
        list[ThemeDefinition], FrontendMutable(widget="theme-settings")
    ] = field(default_factory=list)


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
    server: Annotated[ServerConfig, BackendInternal()] = field(
        default_factory=ServerConfig
    )
    channel: Annotated[ChannelConfig, BackendInternal()] = field(
        default_factory=ChannelConfig
    )
    map: MapConfig = field(default_factory=MapConfig)
    plugins: dict[str, Any] = field(default_factory=dict)
    """Mapping of plugin name to plugin-specific config."""
    cache: Annotated[CacheConfig, BackendInternal()] = field(
        default_factory=CacheConfig
    )

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
            for style in map.get("styles", []) or default_styles()
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
            pass
    return style


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
    core: CoreConfig
    map: MapConfig
    channel: FrontendChannelConfig


#
# typing.Annotated markers and backend <-> frontend logic
#


# TODO: test thoroughly tested with complex structures like list[X|Y] or algebraic types
@dataclass(frozen=True)
class BackendInternal:
    """Marker to exclude a field from being serialized to the frontend.

    Lifecycle of a config whose field(s) are annotated with this:

    1. `tangram.toml` -> backend config: field should be validated strictly
    2. backend -> frontend serialization:
        a. set the field to `_SENTINEL_REDACTED`
        b. then call `remove_redacted_fields` to strip them out
    3. frontend -> backend deserialization: ensure field is missing
    """

    # values to be passed into context during (de)serialization
    _CTX_KEY: ClassVar[str] = "tangram_backend_internal"
    REDACT: ClassVar = object()  # for case 2a
    VERIFY_MISSING: ClassVar = object()  # for case 3

    _SENTINEL_REDACTED: ClassVar = object()
    _SENTINEL_MISSING: ClassVar = object()
    # TODO: thoroughly test whether X | None = None or other defaults are affected
    # TODO: verify TypedDict NotRequired fields still work

    def __get_pydantic_json_schema__(
        self, _core_schema: CoreSchema, _handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        from pydantic_core import PydanticOmit

        raise PydanticOmit

    def __get_pydantic_core_schema__(
        self, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        from pydantic import ValidationInfo
        from pydantic_core import core_schema

        original_schema = handler(source_type)

        def validate(
            value: Any,
            handler: core_schema.ValidatorFunctionWrapHandler,
            info: ValidationInfo,
        ) -> Any:
            if value is self._SENTINEL_MISSING:
                if info.context and (
                    info.context.get(self._CTX_KEY) == self.VERIFY_MISSING
                ):
                    return None  # case 3: frontend should not have this field present
                raise ValueError("Field required")  # case 1

            if info.context and info.context.get(self._CTX_KEY) == self.VERIFY_MISSING:
                raise ValueError(
                    "Security: This internal field must not be present in the request."
                )

            return handler(value)  # case 1: standard type validation

        def serialize(value: Any, info: ValidationInfo) -> Any:
            if info.context and info.context.get(self._CTX_KEY) == self.REDACT:
                return self._SENTINEL_REDACTED  # case 2
            return value

        # set default so case 3 doesn't throw false positive on missing private field
        return core_schema.with_default_schema(
            schema=core_schema.with_info_wrap_validator_function(
                function=validate,
                schema=original_schema,
                serialization=core_schema.plain_serializer_function_ser_schema(
                    function=serialize,
                    info_arg=True,
                    return_schema=core_schema.any_schema(),
                    when_used="always",
                ),
            ),
            default=self._SENTINEL_MISSING,
            validate_default=True,
        )

    @classmethod
    def remove_redacted_fields(cls, obj: dict[str, Any]) -> dict[str, Any]:
        if isinstance(obj, dict):
            return {
                k: cls.remove_redacted_fields(v)
                for k, v in obj.items()
                if v is not cls._SENTINEL_REDACTED
            }
        elif isinstance(obj, list):
            return [
                cls.remove_redacted_fields(item)
                for item in obj
                if item is not cls._SENTINEL_REDACTED
            ]
        # TODO what about other container types? does pydantic.dump_python produce them?
        return obj

    # the split redact-then-remove approach above seems weird because annotating
    # `pydantic.Field(exclude=True)` does the exact same thing: hiding in model_dump.
    # but, when it comes to validation we need to have two cases: validate exists on
    # tangram.toml load, but validate missing on frontend-submitted config.


@dataclass(frozen=True)
class FrontendMutable:
    """Marker to expose a field to the frontend and allow modification."""

    # TODO maybe in the future we can merge the two
    kind: Literal["color"] | None = None
    widget: str | None = None
    """Identifier for a custom widget to use for this field in the frontend UI.
    If multiple fields share the same widget id, they will be grouped together.
    """

    def __get_pydantic_json_schema__(
        self, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        json_schema["tangram_mutable"] = True
        if self.kind:
            json_schema["tangram_kind"] = self.kind
        if self.widget:
            json_schema["tangram_widget"] = self.widget
        return json_schema


class FrontendData(TypedDict):
    config: dict[str, Any]
    config_json_schema: dict[str, Any]


def to_frontend_manifest(adapter: TypeAdapter, backend_cfg: Any) -> FrontendData:
    """Serialises a configuration for the frontend with internal fields removed."""
    config_redacted = adapter.dump_python(
        backend_cfg, context={BackendInternal._CTX_KEY: BackendInternal.REDACT}
    )
    config_cleaned = BackendInternal.remove_redacted_fields(config_redacted)
    config_json_schema = adapter.json_schema()
    return {"config": config_cleaned, "config_json_schema": config_json_schema}


def parse_frontend_config(adapter: TypeAdapter, frontend_cfg: Any) -> Any:
    """Deserialises and validates frontend-submitted config data, ensuring no internal
    fields are present."""
    return adapter.validate_python(
        frontend_cfg, context={BackendInternal._CTX_KEY: BackendInternal.VERIFY_MISSING}
    )
