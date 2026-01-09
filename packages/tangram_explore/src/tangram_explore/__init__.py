from __future__ import annotations

import io
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncGenerator,
    Literal,
    Protocol,
    runtime_checkable,
)

import arro3.core as ac
import arro3.io
import orjson
import tangram_core
from fastapi import APIRouter
from fastapi.responses import Response

if TYPE_CHECKING:
    from tangram_core import BackendState

EXPLORE_CHANNEL = "explore"
EXPLORE_EVENT = "layers"

router = APIRouter(prefix="/explore", tags=["explore"])


@dataclass
class ExploreState:
    data: dict[str, bytes] = field(default_factory=dict)
    layers: dict[str, dict[str, Any]] = field(default_factory=dict)
    layer_order: list[str] = field(default_factory=list)


@asynccontextmanager
async def lifespan(state: BackendState) -> AsyncGenerator[None, None]:
    # monkey-patch backend state to store explore data in memory
    setattr(state, "explore_state", ExploreState())
    yield
    delattr(state, "explore_state")


@router.get("/data/{data_id}")
async def get_explore_data(
    data_id: str, state: tangram_core.InjectBackendState
) -> Response:
    explore_state: ExploreState = getattr(state, "explore_state")
    data = explore_state.data.get(data_id)
    if data is None:
        return Response(status_code=404)
    return Response(content=data, media_type="application/vnd.apache.parquet")


@router.get("/layers")
async def get_layers(state: tangram_core.InjectBackendState) -> list[dict[str, Any]]:
    """Returns the current list of layers to new clients."""
    explore_state: ExploreState = getattr(state, "explore_state")
    return [explore_state.layers[uid] for uid in explore_state.layer_order]


@runtime_checkable
class ArrowStreamExportable(Protocol):
    def __arrow_c_stream__(self, requested_schema: Any = None) -> Any: ...


@dataclass(frozen=True)
class Scatter:
    kind: str = field(default="scatter", init=False)
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

    @property
    def _explore_state(self) -> ExploreState:
        return getattr(self.state, "explore_state")

    async def _broadcast(self, op: str, **kwargs: Any) -> None:
        payload = {"op": op, **kwargs}
        topic = f"to:{EXPLORE_CHANNEL}:{EXPLORE_EVENT}"
        await self.state.redis_client.publish(topic, orjson.dumps(payload))

    async def push(
        self, df: ArrowStreamExportable, style: Scatter, *, label: str | None = None
    ) -> Layer:
        data_id = str(uuid.uuid4())
        parquet_bytes = _to_parquet_bytes(df)

        self._explore_state.data[data_id] = parquet_bytes

        layer_def = {
            "id": data_id,
            "label": label or data_id[:8],
            "url": f"/explore/data/{data_id}",
            "style": asdict(style),
        }
        self._explore_state.layers[data_id] = layer_def
        self._explore_state.layer_order.append(data_id)

        await self._broadcast("add", layer=layer_def)

        return Layer(id=data_id, _session=self)

    async def remove(self, data_id: str) -> None:
        if data_id in self._explore_state.data:
            del self._explore_state.data[data_id]
        if data_id in self._explore_state.layers:
            del self._explore_state.layers[data_id]
        if data_id in self._explore_state.layer_order:
            self._explore_state.layer_order.remove(data_id)
        await self._broadcast("remove", id=data_id)

    async def clear(self) -> None:
        self._explore_state.data.clear()
        self._explore_state.layers.clear()
        self._explore_state.layer_order.clear()
        await self._broadcast("clear")


@dataclass
class ExploreConfig:
    enable_3d: Literal["inherit"] | bool = "inherit"


def transform_config(config_dict: dict[str, Any]) -> ExploreConfig:
    from pydantic import TypeAdapter

    return TypeAdapter(ExploreConfig).validate_python(config_dict)


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    into_frontend_config_function=transform_config,
    lifespan=lifespan,
)
