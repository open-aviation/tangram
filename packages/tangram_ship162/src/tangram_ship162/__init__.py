from dataclasses import dataclass
from typing import Any

import tangram_core
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import TypeAdapter

try:
    import polars as pl

    _HISTORY_AVAILABLE = True
except ImportError:
    _HISTORY_AVAILABLE = False


router = APIRouter(
    prefix="/ship162",
    tags=["ship162"],
    responses={404: {"description": "Not found"}},
)


@router.get("/data/{mmsi}")
async def get_trajectory_data(
    mmsi: int, backend_state: tangram_core.InjectBackendState
) -> list[dict[str, Any]]:
    """Get the full trajectory for a given ship MMSI."""
    if not _HISTORY_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="History feature is not installed. "
            "Install with `pip install 'tangram_ship162[history]'`",
        )

    redis_key = "tangram:history:table_uri:ship162"
    table_uri_bytes = await backend_state.redis_client.get(redis_key)

    if not table_uri_bytes:
        raise HTTPException(
            status_code=404,
            detail=(
                "Table 'ship162' not found.\nhelp: is the history service running?"
            ),
        )
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


@dataclass(frozen=True)
class ShipsConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    ship162_channel: str = "ship162"
    history_table_name: str = "ship162"
    history_control_channel: str = "history:control"
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


def transform_config(config_dict: dict[str, Any]) -> FrontendShipsConfig:
    config = TypeAdapter(ShipsConfig).validate_python(config_dict)
    return FrontendShipsConfig(
        topbar_order=config.topbar_order,
        sidebar_order=config.sidebar_order,
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
    )
    await _ships.run_ships(rust_config)
