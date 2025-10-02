import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd
import tangram
from fastapi import APIRouter
from fastapi.responses import JSONResponse
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
        results = await ts_client.mrange("-", "+", filters=[f"icao24={icao24}"])
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


@router.get("/route/{callsign}")
async def get_route_data(
    callsign: str, backend_state: tangram.InjectBackendState
) -> JSONResponse:
    url = "https://flightroutes.opensky-network.org/api/routeset"
    payload = {"planes": [{"callsign": callsign}]}
    client = backend_state.http_client
    try:
        response = await client.post(url, json=payload, timeout=5.0)
        response.raise_for_status()
        data = response.json()
        return JSONResponse(content=data)
    except Exception as e:
        log.error(f"Failed to fetch route data for {callsign}: {e}")
        return JSONResponse(content=[], status_code=500)


plugin = tangram.Plugin(frontend_path="dist-frontend", routers=[router])


@dataclass(frozen=True)
class PlanesConfig:
    jet1090_channel: str = "jet1090"
    history_expire: int = 20
    stream_interval_secs: float = 1.0
    aircraft_db_url: str = (
        "https://jetvision.de/resources/sqb_databases/basestation.zip"
    )
    aircraft_db_cache_path: str | None = None
    log_level: str = "INFO"
    python_tracing_subscriber: bool = False


@plugin.register_service()
async def run_planes(backend_state: tangram.BackendState) -> None:
    from . import _planes

    plugin_config = backend_state.config.plugins.get("tangram_jet1090", {})
    config_planes = TypeAdapter(PlanesConfig).validate_python(plugin_config)

    default_log_level = plugin_config.get(
        "log_level", backend_state.config.core.log_level
    )

    if config_planes.python_tracing_subscriber:
        layer = tangram.TracingLayer()
        _planes.init_tracing_python(layer, default_log_level)
    else:
        _planes.init_tracing_stderr(default_log_level)

    rust_config = _planes.PlanesConfig(
        redis_url=backend_state.config.core.redis_url,
        jet1090_channel=config_planes.jet1090_channel,
        history_expire=config_planes.history_expire,
        stream_interval_secs=config_planes.stream_interval_secs,
        aircraft_db_url=config_planes.aircraft_db_url,
        aircraft_db_cache_path=config_planes.aircraft_db_cache_path,
    )
    await _planes.run_planes(rust_config)
