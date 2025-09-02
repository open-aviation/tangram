import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd
import tangram
from fastapi import APIRouter
from pydantic import TypeAdapter

log = logging.getLogger(__name__)

router = APIRouter(
    tags=["jet1090"],
    responses={404: {"description": "Not found"}},
)


async def get_values(
    feature: str, icao24: str, backend_state: tangram.InjectBackendState
) -> list[tuple[Any, float]]:
    ts_client = backend_state.redis_client.ts()
    key = f"aircraft:ts:{feature}:{icao24}"
    try:
        data = await ts_client.range(key, "-", "+")
    except Exception as e:
        log.error(f"error fetching data from redis for {key=}: {e}")
        return []
    return [(pd.Timestamp(ts, unit="ms", tz="utc"), value) for (ts, value) in data]


@router.get("/data/{icao24}")
async def get_trajectory_data(
    icao24: str, backend_state: tangram.InjectBackendState
) -> list[dict[str, Any]]:
    """Get the full trajectory for a given ICAO24 address from Redis Time Series."""
    # fmt: off
    features = [
        "latitude", "longitude", "altitude", "groundspeed", "track",
        "vertical_rate", "IAS", "TAS", "selected_altitude", "nacp",
        "roll", "Mach", "heading", "vrate_inertial", "vrate_barometric",
    ]
    # fmt: on
    tasks = [get_values(feature, icao24, backend_state) for feature in features]
    results = await asyncio.gather(*tasks)

    data_frames = [
        pd.DataFrame(data, columns=["timestamp", feature])
        for data, feature in zip(results, features)
        if data
    ]

    if not data_frames:
        return []

    # merge all dataframes on the timestamp index
    merged_df = data_frames[0]
    for df in data_frames[1:]:
        merged_df = pd.merge(merged_df, df, on="timestamp", how="outer")

    merged_df = merged_df.sort_values("timestamp")

    response_data = []
    for _, row in merged_df.iterrows():
        point = {"timestamp": row["timestamp"].timestamp(), "icao24": icao24}
        for feature in features:
            if feature in row and not pd.isna(row[feature]):
                point[feature] = float(row[feature])
        response_data.append(point)

    return response_data


plugin = tangram.Plugin(frontend_path="dist-frontend", routers=[router])


@dataclass(frozen=True)
class PlanesConfig:
    jet1090_channel: str = "jet1090"
    history_expire: int = 20


@plugin.register_service()
async def run_planes(backend_state: tangram.BackendState) -> None:
    from . import _planes

    config_planes = TypeAdapter(PlanesConfig).validate_python(
        backend_state.config.plugins.get("tangram_jet1090", {})
    )

    _planes.init_logging("info")

    rust_config = _planes.PlanesConfig(
        redis_url=backend_state.config.core.redis_url,
        jet1090_channel=config_planes.jet1090_channel,
        history_expire=config_planes.history_expire,
    )
    await _planes.run_planes(rust_config)
