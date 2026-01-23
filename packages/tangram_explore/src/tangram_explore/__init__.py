from __future__ import annotations

import io
import uuid
from contextlib import asynccontextmanager
from dataclasses import KW_ONLY, dataclass, field, fields, is_dataclass
from typing import (
    TYPE_CHECKING,
    Annotated,
    Any,
    AsyncGenerator,
    Literal,
    Protocol,
    cast,
    runtime_checkable,
)

import arro3.core as ac
import arro3.io
import orjson
import tangram_core
from fastapi import APIRouter
from fastapi.responses import Response
from tangram_core.config import ExposeField

if TYPE_CHECKING:
    from typing import TypeAlias

    from tangram_core import BackendState

EXPLORE_CHANNEL = "explore"
EXPLORE_EVENT = "layers"

router = APIRouter(prefix="/explore", tags=["explore"])


LayerId: TypeAlias = str
"""Unique UUID for a layer."""
ParquetBytes: TypeAlias = bytes
LayerConfig: TypeAlias = dict[str, Any]
"""Serialised layer configuration without data or label."""


@dataclass
class ExploreState:
    data: dict[LayerId, ParquetBytes] = field(default_factory=dict)
    layers: dict[LayerId, LayerConfig] = field(default_factory=dict)
    layer_order: list[LayerId] = field(default_factory=list)


@asynccontextmanager
async def lifespan(state: BackendState) -> AsyncGenerator[None, None]:
    setattr(state, "explore_state", ExploreState())
    yield
    delattr(state, "explore_state")


def get_explore_state(state: tangram_core.InjectBackendState) -> ExploreState:
    return cast(ExploreState, getattr(state, "explore_state"))


@router.get("/data/{data_id}")
async def get_explore_data(
    data_id: str, state: tangram_core.InjectBackendState
) -> Response:
    explore_state = get_explore_state(state)
    data = explore_state.data.get(data_id)
    if data is None:
        return Response(status_code=404)  # shouldn't occur
    return Response(content=data, media_type="application/vnd.apache.parquet")


@router.get("/layers")
async def get_layers(state: tangram_core.InjectBackendState) -> list[dict[str, Any]]:
    explore_state = get_explore_state(state)
    return [explore_state.layers[uid] for uid in explore_state.layer_order]


@runtime_checkable
class ArrowStreamExportable(Protocol):
    def __arrow_c_stream__(self, requested_schema: Any = None) -> Any: ...


@runtime_checkable
class ExploreLayer(Protocol):
    data: ArrowStreamExportable
    """Any data structure that implements the
    [Arrow C data interface](https://arrow.apache.org/docs/format/CDataInterface.html),
    such as polars DataFrames or pyarrow Tables."""
    label: str | None
    """Unique name for the layer (optional).
    If not provided, a random 8-character ID will be used."""


@dataclass(frozen=True, slots=True)
class ScatterLayer(ExploreLayer):
    data: ArrowStreamExportable
    _: KW_ONLY
    radius_scale: float = 50.0
    radius_min_pixels: float = 2.0
    radius_max_pixels: float = 5.0
    line_width_min_pixels: float = 1.0
    fill_color: str | list[int] = "#027ec7"
    line_color: str | list[int] = "#000000"
    opacity: float = 0.8
    stroked: bool = False
    filled: bool = True
    pickable: bool = True
    label: str | None = None
    kind: Literal["scatter"] = field(default="scatter", init=False)


def _to_parquet_bytes(df: Any) -> bytes:
    if not isinstance(df, ArrowStreamExportable):
        raise TypeError(
            f"cannot convert {type(df).__name__} to arrow. "
            "object must implement '__arrow_c_stream__' protocol. "
        )

    reader = ac.RecordBatchReader.from_arrow(df)
    sink = io.BytesIO()
    arro3.io.write_parquet(reader, sink)
    return sink.getvalue()


@dataclass(frozen=True, slots=True)
class Layer:
    id: str
    _session: Session

    async def remove(self) -> None:
        await self._session.remove(self.id)


@dataclass(frozen=True, slots=True)
class Session:
    state: BackendState

    def __post_init__(self) -> None:
        if not hasattr(self.state, "explore_state"):
            raise RuntimeError(
                "The 'tangram_explore' plugin is not active. "
                "Ensure it is added to the [core.plugins] list in your config."
            )

    async def _broadcast(self, op: str, **kwargs: Any) -> None:
        payload = {"op": op, **kwargs}
        topic = f"to:{EXPLORE_CHANNEL}:{EXPLORE_EVENT}"
        await self.state.redis_client.publish(topic, orjson.dumps(payload))

    async def push(self, layer: ExploreLayer) -> Layer:
        if not is_dataclass(layer):  # required for fields()
            raise TypeError("layer must be a dataclass")
        if not isinstance(layer, ExploreLayer):
            raise TypeError("layer must implement ExploreLayer protocol")

        data_id = str(uuid.uuid4())
        parquet_bytes = _to_parquet_bytes(layer.data)

        explore_state = get_explore_state(self.state)
        explore_state.data[data_id] = parquet_bytes

        style = {
            f.name: getattr(layer, f.name)
            for f in fields(layer)
            if f.name not in ("data", "label")
        }
        label = getattr(layer, "label", None)

        layer_def = {
            "id": data_id,
            "label": label or data_id[:8],
            "url": f"/explore/data/{data_id}",
            "style": style,
        }
        explore_state.layers[data_id] = layer_def
        explore_state.layer_order.append(data_id)

        await self._broadcast("add", layer=layer_def)

        return Layer(id=data_id, _session=self)

    async def remove(self, data_id: str) -> None:
        explore_state = get_explore_state(self.state)
        if data_id in explore_state.data:
            del explore_state.data[data_id]
        if data_id in explore_state.layers:
            del explore_state.layers[data_id]
        if data_id in explore_state.layer_order:
            explore_state.layer_order.remove(data_id)
        await self._broadcast("remove", id=data_id)

    async def clear(self) -> None:
        explore_state = get_explore_state(self.state)
        explore_state.data.clear()
        explore_state.layers.clear()
        explore_state.layer_order.clear()
        await self._broadcast("clear")


@dataclass
class ExploreConfig:
    enable_3d: Annotated[Literal["inherit"] | bool, ExposeField()] = "inherit"
    """Whether to render scatter points in 3D"""


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    config_class=ExploreConfig,
    lifespan=lifespan,
)
