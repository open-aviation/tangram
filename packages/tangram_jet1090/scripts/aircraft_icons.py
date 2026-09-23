from __future__ import annotations

import io
import json
import math
from pathlib import Path
from typing import Annotated

import cairosvg
import typer
from PIL import Image
from pydantic import ConfigDict, Field, TypeAdapter, with_config
from pydantic.dataclasses import dataclass
from svgpathtools import parse_path
from typing_extensions import TypedDict

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
METADATA_PATH = PACKAGE_ROOT / "src/tangram_jet1090/aircraft-icons.json"
SOURCES_PATH = PACKAGE_ROOT / "data/aircraft-icons.toml"
SCHEMA_PATH = PACKAGE_ROOT / "data/aircraft-icons.schema.json"
ATLAS_PATH = PACKAGE_ROOT / "src/tangram_jet1090/aircraft-atlas.png"
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

PositiveInt = Annotated[int, Field(gt=0)]
PositiveFloat = Annotated[float, Field(gt=0)]
NonEmptyString = Annotated[str, Field(min_length=1)]
SymbolId = Annotated[str, Field(pattern=r"^[A-Z0-9]+$")]


@with_config(ConfigDict(extra="forbid", title="Atlas Layout"))
class AtlasDocument(TypedDict):
    spriteSize: PositiveInt
    gutter: Annotated[int, Field(ge=0)]
    columns: PositiveInt


@with_config(ConfigDict(extra="forbid", title="Aircraft Icon Metadata"))
class MetadataDocument(TypedDict):
    atlas: AtlasDocument
    symbols: Annotated[list[SymbolId], Field(min_length=1)]
    aliases: list[tuple[NonEmptyString, SymbolId]]


@dataclass(config=ConfigDict(extra="forbid"), frozen=True)
class AtlasSource:
    supersample: PositiveInt
    path_scale: PositiveFloat
    stroke_width: PositiveFloat


@dataclass(config=ConfigDict(extra="forbid"), frozen=True)
class PaletteSource:
    normal: NonEmptyString
    selected: NonEmptyString
    stroke: NonEmptyString


@dataclass(config=ConfigDict(extra="forbid"), frozen=True)
class IconSource:
    path: NonEmptyString
    scale: PositiveFloat = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0
    rotate_deg: float = 0.0
    enabled: bool = True


@dataclass(config=ConfigDict(extra="forbid"), frozen=True)
class SourceDocument:
    atlas: AtlasSource
    palette: PaletteSource
    icons: Annotated[dict[SymbolId, IconSource], Field(min_length=1)]


METADATA_ADAPTER = TypeAdapter(MetadataDocument)
SOURCE_ADAPTER = TypeAdapter(SourceDocument)
app = typer.Typer(add_completion=False, no_args_is_help=True)


def render_sprite(
    source: IconSource,
    fill: str,
    stroke: str,
    sprite_size: int,
    render: AtlasSource,
) -> Image.Image:
    min_x, max_x, min_y, max_y = parse_path(source.path).bbox()
    scale = source.scale * render.path_scale
    translate_x = -(min_x + max_x) / 2 + source.offset_x
    translate_y = -(min_y + max_y) / 2 + source.offset_y
    stroke_width = render.stroke_width / scale
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{sprite_size}" height="{sprite_size}" viewBox="-16 -16 32 32" shape-rendering="geometricPrecision">
<path d={json.dumps(source.path)} fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width:.12g}" transform="rotate({-source.rotate_deg:.12g}) scale({scale:.12g}) translate({translate_x:.12g} {translate_y:.12g})"/>
</svg>"""
    rendered = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=sprite_size * render.supersample,
        output_height=sprite_size * render.supersample,
    )
    return (
        Image.open(io.BytesIO(rendered))
        .convert("RGBA")
        .convert("RGBa")
        .resize((sprite_size, sprite_size), Image.Resampling.LANCZOS)
        .convert("RGBA")
    )


def render_atlas(metadata: MetadataDocument, sources: SourceDocument) -> bytes:
    enabled_icons = {
        symbol: source for symbol, source in sources.icons.items() if source.enabled
    }
    if list(enabled_icons) != metadata["symbols"]:
        raise ValueError("enabled TOML icons must match frontend symbols in order")

    atlas = metadata["atlas"]
    styles = (
        sources.palette.normal,
        sources.palette.selected,
    )
    cell_size = atlas["spriteSize"] + 2 * atlas["gutter"]
    rows = math.ceil(len(enabled_icons) * len(styles) / atlas["columns"])
    image = Image.new(
        "RGBA",
        (atlas["columns"] * cell_size, rows * cell_size),
        (0, 0, 0, 0),
    )

    for symbol_index, source in enumerate(enabled_icons.values()):
        for style_index, fill in enumerate(styles):
            index = symbol_index * len(styles) + style_index
            column = index % atlas["columns"]
            row = index // atlas["columns"]
            image.alpha_composite(
                render_sprite(
                    source,
                    fill,
                    sources.palette.stroke,
                    atlas["spriteSize"],
                    sources.atlas,
                ),
                (
                    column * cell_size + atlas["gutter"],
                    row * cell_size + atlas["gutter"],
                ),
            )

    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def render_schema() -> bytes:
    schema = {"$schema": JSON_SCHEMA_DIALECT, **SOURCE_ADAPTER.json_schema()}
    return (json.dumps(schema, separators=(",", ":"), sort_keys=True) + "\n").encode()


def generate() -> dict[Path, bytes]:
    metadata = METADATA_ADAPTER.validate_json(METADATA_PATH.read_bytes())
    sources = SOURCE_ADAPTER.validate_python(tomllib.loads(SOURCES_PATH.read_text()))
    return {
        ATLAS_PATH: render_atlas(metadata, sources),
        SCHEMA_PATH: render_schema(),
    }


@app.command()
def build() -> None:
    """Build the aircraft atlas and metadata schema."""
    for path, content in generate().items():
        path.write_bytes(content)
        typer.echo(f"wrote {path.relative_to(PACKAGE_ROOT)}")


@app.command()
def check() -> None:
    """Type-check inputs and verify generated artifacts."""
    stale = [
        path
        for path, content in generate().items()
        if not path.exists() or path.read_bytes() != content
    ]
    for path in stale:
        typer.echo(f"out of date: {path.relative_to(PACKAGE_ROOT)}", err=True)
    if stale:
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
