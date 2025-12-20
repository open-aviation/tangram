import logging

import polars as pl
import tangram_core
from fastapi import APIRouter, Response

router = APIRouter(
    prefix="/explore",
    tags=["explore"],
    responses={404: {"description": "Not found"}},
)
log = logging.getLogger(__name__)
redis_key = "tangram:history:table_uri:jet1090"


@router.get("/all")
async def get_all(backend_state: tangram_core.InjectBackendState) -> Response:
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    table_uri = table_uri_bytes.decode("utf-8")
    df = pl.scan_delta(table_uri).collect()
    return Response(df.write_json(), media_type="application/json")


@router.get("/count")
async def get_count(backend_state: tangram_core.InjectBackendState) -> Response:
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    table_uri = table_uri_bytes.decode("utf-8")
    df = (
        pl.scan_delta(table_uri)
        .group_by(["icao24", "callsign"])
        .agg(pl.len().alias("n_rows"))
        .sort("n_rows", descending=True)
        .collect()
    )
    return Response(df.write_json(), media_type="application/json")


@router.get("/stats")
async def get_stats(backend_state: tangram_core.InjectBackendState) -> Response:
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    table_uri = table_uri_bytes.decode("utf-8")
    df = pl.scan_delta(table_uri)

    intervals = (
        df.sort(["icao24", "timestamp"])
        # forward-fill callsign within each aircraft
        .with_columns(pl.col("callsign").forward_fill().over("icao24"))
        # compute gaps in minutes
        .with_columns(
            gap_minutes=(
                pl.col("timestamp") - pl.col("timestamp").shift(1)
            ).dt.total_minutes()
        )
        # mark new intervals: first row, gap ≥ 30 min, or callsign/icao24 change
        .with_columns(
            new_interval=(
                (pl.col("gap_minutes") >= 30)
                | (pl.col("icao24") != pl.col("icao24").shift(1))
                | (pl.col("callsign") != pl.col("callsign").shift(1))
            ).fill_null(True)
        )
        # assign interval IDs
        .with_columns(interval_id=pl.col("new_interval").cast(pl.Int64).cum_sum())
        # aggregate per interval
        .group_by(["icao24", "callsign", "interval_id"])
        .agg(
            start_ts=pl.col("timestamp").min(),
            end_ts=pl.col("timestamp").max(),
            n_rows=pl.len(),
        )
        .sort(["n_rows", "icao24"], descending=True)
        .filter(pl.col("n_rows") >= 5)
        .with_columns(
            duration=((pl.col("end_ts") - pl.col("start_ts")).dt.total_seconds()),
        )
        .collect()  # executes lazy query
    )

    return Response(intervals.write_json(), media_type="application/json")


@router.get("/history/{icao24}/{start_timestamp}/{end_timestamp}")
async def get_history(
    icao24: str,
    start_timestamp: int,
    end_timestamp: int,
    backend_state: tangram_core.InjectBackendState,
) -> Response:
    """Get the trajectory history for a given ICAO24 address within a time range."""
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    table_uri = table_uri_bytes.decode("utf-8")
    # Convert start_timestamp and end_timestamp (unix seconds) to polars datetime
    # If you need to use these as datetime objects, use pl.from_epoch

    start_dt = pl.lit(start_timestamp).cast(pl.Datetime("ms"))
    end_dt = pl.lit(end_timestamp).cast(pl.Datetime("ms"))
    df = (
        pl.scan_delta(table_uri)
        .filter(
            (pl.col("icao24") == icao24)
            & (pl.col("timestamp") >= start_dt)
            & (pl.col("timestamp") <= end_dt)
        )
        .sort("timestamp")
        .collect()
    )
    return Response(df.write_json(), media_type="application/json")


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
)
