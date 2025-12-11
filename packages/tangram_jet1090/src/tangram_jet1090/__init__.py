from __future__ import annotations

import logging
import sqlite3
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import platformdirs
import tangram_core
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse, Response
from pydantic import TypeAdapter

if TYPE_CHECKING:
    from . import _planes

try:
    import polars as pl

    _HISTORY_AVAILABLE = True
except ImportError:
    _HISTORY_AVAILABLE = False


log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/jet1090",
    tags=["jet1090"],
    responses={404: {"description": "Not found"}},
)


@router.get("/data/{icao24}")
async def get_trajectory_data(
    icao24: str, backend_state: tangram_core.InjectBackendState
) -> Response:
    """Get the full trajectory for a given ICAO24 address."""
    if not _HISTORY_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="History feature is not installed. "
            "Install with `pip install 'tangram_jet1090[history]'`",
        )

    redis_key = "tangram:history:table_uri:jet1090"
    table_uri_bytes = await backend_state.redis_client.get(redis_key)

    if not table_uri_bytes:
        raise HTTPException(
            status_code=404,
            detail=(
                "Table 'jet1090' not found.\nhelp: is the history service running?"
            ),
        )
    table_uri = table_uri_bytes.decode("utf-8")

    try:
        df = (
            pl.scan_delta(table_uri)
            .filter(pl.col("icao24") == icao24)
            .with_columns(pl.col("timestamp").dt.epoch(time_unit="s"))
            .sort("timestamp")
            .collect()
        )
        return Response(df.write_json(), media_type="application/json")
    except Exception as e:
        log.error(f"Failed to query trajectory for {icao24}: {e}")
        raise HTTPException(status_code=500, detail="Failed to query trajectory data.")


@router.get("/route/{callsign}")
async def get_route_data(
    callsign: str, backend_state: tangram_core.InjectBackendState
) -> ORJSONResponse:
    url = "https://flightroutes.opensky-network.org/api/routeset"
    payload = {"planes": [{"callsign": callsign}]}
    client = backend_state.http_client
    try:
        response = await client.post(url, json=payload, timeout=5.0)
        response.raise_for_status()
        data = response.json()
        return ORJSONResponse(content=data)
    except Exception as e:
        log.error(f"Failed to fetch route data for {callsign}: {e}")
        return ORJSONResponse(content=[], status_code=500)


@router.get("/sensors")
async def get_sensors_data(
    backend_state: tangram_core.InjectBackendState,
) -> ORJSONResponse:
    plugin_config = backend_state.config.plugins.get("tangram_jet1090", {})
    config = TypeAdapter(PlanesConfig).validate_python(plugin_config)
    # Keeping "localhost" in the URL can lead to issues on systems where localhost
    # does not resolve to 127.0.0.1 first but rather to ::1 (IPv6).
    # Therefore, we replace it explicitly.
    url = f"{config.jet1090_url}/sensors".replace("localhost", "127.0.0.1")

    try:
        response = await backend_state.http_client.get(url, timeout=10.0)
        response.raise_for_status()
        return ORJSONResponse(content=response.json())
    except Exception as e:
        log.error(f"Failed to fetch sensors data from {url}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@dataclass(frozen=True)
class FrontendPlanesConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    show_route_lines: bool
    topbar_order: int
    sidebar_order: int


def transform_config(config_dict: dict[str, Any]) -> FrontendPlanesConfig:
    config = TypeAdapter(PlanesConfig).validate_python(config_dict)
    return FrontendPlanesConfig(
        show_route_lines=config.show_route_lines,
        topbar_order=config.topbar_order,
        sidebar_order=config.sidebar_order,
    )


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    into_frontend_config_function=transform_config,
)


@dataclass(frozen=True)
class PlanesConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    jet1090_channel: str = "jet1090"
    history_table_name: str = "jet1090"
    history_control_channel: str = "history:control"
    state_vector_expire: int = 20
    stream_interval_secs: float = 1.0
    aircraft_db_url: str = (
        "https://jetvision.de/resources/sqb_databases/basestation.zip"
    )
    jet1090_url: str = "http://localhost:8080"
    path_cache: Path = Path(platformdirs.user_cache_dir("tangram_jet1090"))
    log_level: str = "INFO"
    show_route_lines: bool = True
    # flush is primarily time-based. this buffer is a backpressure mechanism.
    history_buffer_size: int = 100_000
    history_flush_interval_secs: int = 5
    history_optimize_interval_secs: int = 120
    history_optimize_target_file_size: int = 134217728
    history_vacuum_interval_secs: int = 120
    history_vacuum_retention_period_secs: int | None = 120
    topbar_order: int = 50
    sidebar_order: int = 50


# NOTE: we fetch the aircraft database on the python side, not Rust. two reasons:
# - the httpx AsyncClient is already available in the tangram core, and the user may
#   have configured proxies, timeouts, etc, so we want to respect that
# - moving the implementation into Rust adds complexity. in particular:
#   - apache datafusion (used by `tangram_history`) depends on `xz2`
#     but `zip` depends on the newer `liblzma` fork:
#     https://github.com/apache/datafusion/issues/15342
#   - `maturin_action` requires that `openssl_probe` is configured correctly
#     for aarch64 and other nonstandard platforms:
#     https://github.com/PyO3/maturin-action/discussions/162
# so for simplicity we just do it here.
async def get_aircraft_db(
    client: httpx.AsyncClient, url: str, path_cache: Path
) -> dict[str, _planes.Aircraft]:
    from . import _planes

    path_cache.mkdir(parents=True, exist_ok=True)
    zip_path = path_cache / "basestation.zip"
    db_path = path_cache / "basestation.sqb"

    if not zip_path.exists():
        log.info(f"downloading aircraft database from {url} to {zip_path}")
        async with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with zip_path.open("wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)

    if not db_path.exists():
        log.info(f"extracting {zip_path} to {db_path}")
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            db_filename = zip_ref.namelist()[0]
            zip_ref.extract(db_filename, path=path_cache)
            (path_cache / db_filename).rename(db_path)

    db = {}
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = con.cursor()
        res = cur.execute("SELECT ModeS, Registration, ICAOTypeCode FROM Aircraft")
        for modes, registration, icaotypecode in res.fetchall():
            if modes:
                db[modes.lower()] = _planes.Aircraft(
                    registration=registration,
                    typecode=icaotypecode,
                )
        con.close()
    except sqlite3.Error as e:
        log.error(f"error reading aircraft database {db_path}: {e}")
        db_path.unlink(missing_ok=True)

    return db


@plugin.register_service()
async def run_planes(backend_state: tangram_core.BackendState) -> None:
    from . import _planes

    plugin_config = backend_state.config.plugins.get("tangram_jet1090", {})
    config_planes = TypeAdapter(PlanesConfig).validate_python(plugin_config)

    default_log_level = plugin_config.get(
        "log_level", backend_state.config.core.log_level
    )

    _planes.init_tracing_stderr(default_log_level)

    aircraft_db = await get_aircraft_db(
        backend_state.http_client,
        config_planes.aircraft_db_url,
        config_planes.path_cache,
    )

    rust_config = _planes.PlanesConfig(
        redis_url=backend_state.config.core.redis_url,
        jet1090_channel=config_planes.jet1090_channel,
        history_table_name=config_planes.history_table_name,
        state_vector_expire=config_planes.state_vector_expire,
        stream_interval_secs=config_planes.stream_interval_secs,
        aircraft_db=aircraft_db,
        history_buffer_size=config_planes.history_buffer_size,
        history_flush_interval_secs=config_planes.history_flush_interval_secs,
        history_control_channel=config_planes.history_control_channel,
        history_optimize_interval_secs=config_planes.history_optimize_interval_secs,
        history_optimize_target_file_size=config_planes.history_optimize_target_file_size,
        history_vacuum_interval_secs=config_planes.history_vacuum_interval_secs,
        history_vacuum_retention_period_secs=config_planes.history_vacuum_retention_period_secs,
    )
    await _planes.run_planes(rust_config)
