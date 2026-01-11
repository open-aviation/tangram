from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import tangram_core
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse, Response
from pydantic import TypeAdapter

try:
    import polars as pl

    _HISTORY_AVAILABLE = True
except ImportError:
    _HISTORY_AVAILABLE = False

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/ship162",
    tags=["ship162"],
    responses={404: {"description": "Not found"}},
)


@router.get("/data/{mmsi}")
async def get_trajectory_data(
    mmsi: int, backend_state: tangram_core.InjectBackendState
) -> Response:
    """Get the full trajectory for a given ship MMSI."""
    if not _HISTORY_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="History feature is not installed.",
        )

    redis_key = "tangram:history:table_uri:ship162"
    table_uri_bytes = await backend_state.redis_client.get(redis_key)

    if not table_uri_bytes:
        raise HTTPException(status_code=404, detail="Table 'ship162' not found.")
    table_uri = table_uri_bytes.decode("utf-8")

    try:
        df = (
            pl.scan_delta(table_uri)
            .filter(pl.col("mmsi") == mmsi)
            .with_columns(pl.col("timestamp").dt.epoch(time_unit="s"))
            .sort("timestamp")
            .collect()
        )
        return Response(df.write_json(), media_type="application/json")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to query trajectory data: {e}"
        )


@router.get("/search")
async def search_ships(
    q: str, backend_state: tangram_core.InjectBackendState
) -> Response:
    if not _HISTORY_AVAILABLE:
        return ORJSONResponse(content=[])

    redis_key = "tangram:history:table_uri:ship162"
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    if not table_uri_bytes:
        return ORJSONResponse(content=[])
    table_uri = table_uri_bytes.decode("utf-8")

    try:
        df = pl.scan_delta(table_uri)
        q_lower = q.lower()

        candidates = (
            df.filter(
                pl.col("ship_name").str.to_lowercase().str.contains(q_lower)
                | pl.col("mmsi").cast(pl.String).str.contains(q_lower)
                | pl.col("callsign").str.to_lowercase().str.contains(q_lower)
            )
            .select("mmsi")
            .unique()
            .head(20)
            .collect()
        )
        candidate_mmsis = candidates["mmsi"].to_list()

        if not candidate_mmsis:
            return ORJSONResponse(content=[])

        intervals = (
            df.filter(pl.col("mmsi").is_in(candidate_mmsis))
            .sort(["mmsi", "timestamp"])
            .with_columns(pl.col("ship_name").forward_fill().over("mmsi"))
            .with_columns(
                gap_minutes=(
                    pl.col("timestamp") - pl.col("timestamp").shift(1)
                ).dt.total_minutes()
            )
            .with_columns(
                new_interval=(
                    (pl.col("gap_minutes") >= 60)
                    | (pl.col("mmsi") != pl.col("mmsi").shift(1))
                ).fill_null(True)
            )
            .with_columns(interval_id=pl.col("new_interval").cast(pl.Int64).cum_sum())
            .group_by(["mmsi", "ship_name", "interval_id"])
            .agg(
                start_ts=pl.col("timestamp").min(),
                end_ts=pl.col("timestamp").max(),
                n_rows=pl.len(),
                lat=pl.col("latitude").mean(),
                lon=pl.col("longitude").mean(),
            )
            .filter((pl.col("n_rows") >= 5))
            .with_columns(
                duration=((pl.col("end_ts") - pl.col("start_ts")).dt.total_seconds()),
            )
            .sort(["start_ts"], descending=True)
            .collect()
        )
        return Response(intervals.write_json(), media_type="application/json")
    except Exception as e:
        log.error(f"Search failed: {e}")
        return ORJSONResponse(content=[])


@router.get("/history/{mmsi}/{start_timestamp}/{end_timestamp}")
async def get_history_slice(
    mmsi: int,
    start_timestamp: int,
    end_timestamp: int,
    backend_state: tangram_core.InjectBackendState,
) -> Response:
    if not _HISTORY_AVAILABLE:
        return ORJSONResponse(content=[])

    redis_key = "tangram:history:table_uri:ship162"
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    if not table_uri_bytes:
        return ORJSONResponse(content=[])
    table_uri = table_uri_bytes.decode("utf-8")

    start_dt = pl.lit(start_timestamp).cast(pl.Datetime("ms"))
    end_dt = pl.lit(end_timestamp).cast(pl.Datetime("ms"))

    try:
        df = (
            pl.scan_delta(table_uri)
            .filter(
                (pl.col("mmsi") == mmsi)
                & (pl.col("timestamp") >= start_dt)
                & (pl.col("timestamp") <= end_dt)
            )
            .sort("timestamp")
            .collect()
        )
        return Response(df.write_json(), media_type="application/json")
    except Exception as e:
        log.error(f"History slice failed: {e}")
        return ORJSONResponse(content=[])


@dataclass(frozen=True)
class ShipsConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    ship162_channel: str = "ship162"
    history_table_name: str = "ship162"
    history_control_channel: str = "history:control"
    search_channel: str = "ship162:search"
    state_vector_expire: int = 600  # 10 minutes
    stream_interval_secs: float = 1.0
    log_level: str = "INFO"
    history_buffer_size: int = 100_000
    history_flush_interval_secs: int = 5
    history_optimize_interval_secs: int = 120
    history_optimize_target_file_size: int = 134217728
    history_vacuum_interval_secs: int = 120
    history_vacuum_retention_period_secs: int | None = 120
    topbar_order: int = 100
    sidebar_order: int = 100


@dataclass(frozen=True)
class FrontendShipsConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    topbar_order: int
    sidebar_order: int
    search_channel: str


def transform_config(config_dict: dict[str, Any]) -> FrontendShipsConfig:
    config = TypeAdapter(ShipsConfig).validate_python(config_dict)
    return FrontendShipsConfig(
        topbar_order=config.topbar_order,
        sidebar_order=config.sidebar_order,
        search_channel=config.search_channel,
    )


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    into_frontend_config_function=transform_config,
)


@plugin.register_service()
async def run_ships(backend_state: tangram_core.BackendState) -> None:
    from . import _ships

    plugin_config = backend_state.config.plugins.get("tangram_ship162", {})
    config_ships = TypeAdapter(ShipsConfig).validate_python(plugin_config)

    default_log_level = plugin_config.get(
        "log_level", backend_state.config.core.log_level
    )

    _ships.init_tracing_stderr(default_log_level)

    rust_config = _ships.ShipsConfig(
        redis_url=backend_state.config.core.redis_url,
        ship162_channel=config_ships.ship162_channel,
        history_control_channel=config_ships.history_control_channel,
        state_vector_expire=config_ships.state_vector_expire,
        stream_interval_secs=config_ships.stream_interval_secs,
        history_table_name=config_ships.history_table_name,
        history_buffer_size=config_ships.history_buffer_size,
        history_flush_interval_secs=config_ships.history_flush_interval_secs,
        history_optimize_interval_secs=config_ships.history_optimize_interval_secs,
        history_optimize_target_file_size=config_ships.history_optimize_target_file_size,
        history_vacuum_interval_secs=config_ships.history_vacuum_interval_secs,
        history_vacuum_retention_period_secs=config_ships.history_vacuum_retention_period_secs,
        search_channel=config_ships.search_channel,
    )
    await _ships.run_ships(rust_config)
