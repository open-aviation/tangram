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


@router.get("/data/{icao24}")
async def get_trajectory_data(
    icao24: str, backend_state: tangram.InjectBackendState
) -> list[dict[str, Any]]:
    """Get the full trajectory for a given ICAO24 address from Redis Time Series."""
    ts_client = backend_state.redis_client.ts()
    try:
        results = await ts_client.mrange(
            "-", "+", filters=[f"icao24={icao24}"]
        )
    except Exception as e:
        log.error(f"mrange failed for {icao24=}: {e}")
        return []

    if not results:
        return []

    data_frames = []
    for result_dict in results:
        # value: (labels, data_points)
        for key, value in result_dict.items():
            # aircraft:ts:{feature}:{icao24}
            feature = key.split(":")[2]
            if not (data := value[1]):
                continue
            df = pd.DataFrame(
                [(pd.Timestamp(ts, unit="ms", tz="utc"), val) for ts, val in data],
                columns=["timestamp", feature],
            )
            data_frames.append(df)

    if not data_frames:
        return []

    # merge all dataframes on the timestamp index
    merged_df = data_frames[0]
    for df in data_frames[1:]:
        merged_df = pd.merge(merged_df, df, on="timestamp", how="outer")

    merged_df = merged_df.sort_values("timestamp").fillna(pd.NA)

    response_data = []
    for _, row in merged_df.iterrows():
        point = {"timestamp": row["timestamp"].timestamp(), "icao24": icao24}
        for col in merged_df.columns:
            if col not in ["timestamp", "icao24"] and pd.notna(row[col]):
                point[col] = float(row[col])
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
