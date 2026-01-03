import logging

import polars as pl
import tangram_core
from fastapi import APIRouter, Response
from fastapi.responses import ORJSONResponse

router = APIRouter(
    prefix="/explore",
    tags=["explore"],
    responses={404: {"description": "Not found"}},
)
log = logging.getLogger(__name__)
redis_key = "tangram:history:table_uri:jet1090"


@router.get("/search")
async def search_flights(
    q: str, backend_state: tangram_core.InjectBackendState
) -> Response:
    table_uri_bytes = await backend_state.redis_client.get(redis_key)
    if not table_uri_bytes:
        return ORJSONResponse(content=[])
    table_uri = table_uri_bytes.decode("utf-8")

    df = pl.scan_delta(table_uri)
    q_lower = q.lower()

    # forward_fill -> callsign.contains causes OOM, so we
    # first find aircraft that *ever* matched the query
    # then fetch full history for those candidates
    candidates = (
        df.filter(
            pl.col("callsign").str.to_lowercase().str.contains(q_lower)
            | pl.col("icao24").str.contains(q_lower)
        )
        .select("icao24")
        .unique()
        .head(20)
        .collect()
    )
    candidate_icaos = candidates["icao24"].to_list()

    if not candidate_icaos:
        return ORJSONResponse(content=[])

    intervals = (
        df.filter(pl.col("icao24").is_in(candidate_icaos))
        .sort(["icao24", "timestamp"])
        .with_columns(pl.col("callsign").forward_fill().over("icao24"))
        .with_columns(
            gap_minutes=(
                pl.col("timestamp") - pl.col("timestamp").shift(1)
            ).dt.total_minutes()
        )
        .with_columns(
            new_interval=(
                (pl.col("gap_minutes") >= 30)
                | (pl.col("icao24") != pl.col("icao24").shift(1))
                | (pl.col("callsign") != pl.col("callsign").shift(1))
            ).fill_null(True)
        )
        .with_columns(interval_id=pl.col("new_interval").cast(pl.Int64).cum_sum())
        .group_by(["icao24", "callsign", "interval_id"])
        .agg(
            start_ts=pl.col("timestamp").min(),
            end_ts=pl.col("timestamp").max(),
            n_rows=pl.len(),
            lat=pl.col("latitude").mean(),
            lon=pl.col("longitude").mean(),
        )
        .filter(
            (pl.col("n_rows") >= 5)
            & (
                pl.col("callsign").str.to_lowercase().str.contains(q_lower)
                | pl.col("icao24").str.contains(q_lower)
            )
        )
        .with_columns(
            duration=((pl.col("end_ts") - pl.col("start_ts")).dt.total_seconds()),
        )
        .sort(["start_ts"], descending=True)
        .collect()
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
