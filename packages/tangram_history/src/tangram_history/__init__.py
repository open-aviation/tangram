import logging
from typing import Any

import pandas as pd
import tangram
from fastapi import APIRouter
from redis.asyncio import Redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/history",
    tags=["history"],
    responses={404: {"description": "Not found"}},
)


async def ensure_redis_client(redis_client: Redis) -> None:
    assert redis_client, "Redis client is not initialized"
    if not await redis_client.ping():
        log.error("fail to ping redis")
        raise Exception("Redis instance is not available")


@router.get("/values/{feature}/{icao24}")
async def get_values(
    feature: str, icao24: str, backend_state: tangram.InjectBackendState
) -> list[tuple[Any, float]]:
    """Get the latest altitude for a given ICAO24 address."""
    ts_client = backend_state.redis_client.ts()

    key = f"aircraft:ts:{feature}:{icao24}"
    try:
        data = await ts_client.range(key, "-", "+")
    except Exception as e:
        log.error(f"Error fetching data from Redis: {e}")
        return []
    data = [(pd.Timestamp(ts, unit="ms", tz="utc"), value) for (ts, value) in data]

    return data


@router.get("/track/{icao24}")
async def get_track(icao24: str, backend_state: tangram.InjectBackendState) -> list[dict[str, Any]]:
    features = [
        "latitude",
        "longitude",
        "altitude",
        "groundspeed",
        "track",
        "vertical_rate",
        "IAS",
        "TAS",
        "selected_altitude",
        "nacp",
        "roll",
        "Mach",
        "heading",
        "vrate_inertial",
        "vrate_barometric",
    ]
    data_list = [await get_values(feature, icao24, backend_state) for feature in features]
    data = [
        pd.DataFrame(d, columns=["timestamp", feature])
        for (d, feature) in zip(data_list, features)
        if len(d) > 0
    ]
    if not data:
        return []

    # Merge all dataframes on timestamp
    merged_df = data[0]
    for df in data[1:]:
        merged_df = pd.merge(merged_df, df, on="timestamp", how="outer")

    # Sort by timestamp
    merged_df = merged_df.sort_values("timestamp")
    # Convert to list of dictionaries for JSON response
    result = []
    for _, row in merged_df.iterrows():
        point = {"timestamp": row["timestamp"].timestamp()}
        for feature in [*features, "icao24"]:
            if feature in row and not pd.isna(row[feature]):
                point[feature] = float(row[feature])
        point["icao24"] = icao24
        result.append(point)

    return result


plugin = tangram.Plugin(routers=[router])
