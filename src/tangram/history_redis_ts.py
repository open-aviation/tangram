#!/usr/bin/env python
# coding: utf8

"""
Redis-based Aircraft History Tracking System with Time Series
============================================================

This module implements an aircraft tracking system that uses Redis Time Series for state
management and historical data storage. It subscribes to aircraft messages, processes
them, and maintains both current state and historical positions of aircraft using
Redis's native time series capabilities.

Redis Key Structure:
-------------------
The system uses the following Redis key patterns:

1. Current Aircraft State:
   - Key: `aircraft:current:{icao24}`
   - Value: JSON encoded StateVector object
   - TTL: 10 minutes (to clean up stale aircraft)
   - Purpose: Stores the last known state of each aircraft

2. Last Write Tracking:
   - Key: `aircraft:lastwrite:{icao24}`
   - Value: Timestamp (float)
   - TTL: 10 minutes
   - Purpose: Tracks when we last wrote history for this aircraft to implement the
     aggregation interval

3. Time Series Data:
   - Key patterns:
     - `aircraft:ts:latitude:{icao24}`
     - `aircraft:ts:longitude:{icao24}`
     - `aircraft:ts:altitude:{icao24}`
     - `aircraft:ts:track:{icao24}`
   - Value: Time series of measurements
   - Labels: Aircraft metadata (icao24, registration, typecode, callsign, type)
   - Retention: Configurable (default 10 minutes)
   - Purpose: Efficient storage and querying of time-based aircraft data

Benefits of Redis Time Series:
----------------------------
1. Memory Efficiency: Optimized storage for time series data
2. Built-in Aggregation: Supports downsampling and aggregation functions
3. Automatic Retention: Configurable data expiration
4. Range Queries: Efficient retrieval of data by time range
5. Labeled Data: Each time series can be tagged with metadata for easy filtering

Usage:
-----
The module can be used as a standalone service or its components can be imported and
used in other applications.

By default it's managed by process-compose and is run in tangram container.

- Run it as an independent container:
$ just tangram-plugin history_redis

You get a container named history_redis, then you can exec a ipython REPL:
$ podman container exec -it -e TERM=xterm-256color history_redis uv run ipython

You will want to apply `%autoawait` first to enable async support in ipython.

- From within the tangram container:

$ LOG_LEVEL=DEBUG uv run python -m tangram.history_redis2

- From Python REPL:

Use one of the following methods to start a REPL:

- python -m asyncio
- ipython with %autoawait
- uv run ipython

from tangram import history_redis2

# Create a client to interact with the aircraft data
# if you REDIS_URL is set in environmental variable, you are good to go
client = history_redis2.StateClient()

# Get current aircraft
count = await client.get_aircraft_count()
aircraft = await client.get_aircraft_table()

# Get track for a specific aircraft
track = await client.get_aircraft_track("a0b1c2")

# Get summary of active aircraft
positions = await client.get_current_positions()

# Get time series info and labels
ts_info = await client.get_timeseries_info("a0b1c2")
ts_labels = await client.get_timeseries_labels("a0b1c2")

Useful Redis Commands:
---------------------
Use redis-cli or iredis

Basic Operations:
- Get all keys for a pattern: `KEYS aircraft:*`
- Get a specific aircraft state: `GET aircraft:current:{icao24}`
- Check TTL for a key: `TTL aircraft:current:{icao24}`
- Delete a key: `DEL aircraft:current:{icao24}`

Time Series Operations:
- Get time series info: `TS.INFO aircraft:ts:latitude:{icao24}`
- Get time series range: `TS.RANGE aircraft:ts:latitude:{icao24} {start} {end}`
- Get time series with labels: `TS.MRANGE {start} {end} FILTER icao24={icao24}`
- Count time series points:
  `TS.INFO aircraft:ts:latitude:{icao24} | grep "total_samples"`

Batch Operations:
- Get multiple aircraft states: `MGET aircraft:current:{icao1} aircraft:current:{icao2}`
- Scan for keys with cursor: `SCAN 0 MATCH aircraft:current:* COUNT 100`

Monitoring:
- Monitor all operations: `MONITOR`
- Get Redis stats: `INFO`
- Get memory usage: `MEMORY USAGE aircraft:current:{icao24}`
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import msgspec
import rs1090
from redis.asyncio import Redis
from redis.commands.timeseries import TimeSeries

from tangram.common import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


def create_redis_client(
    redis_client: Optional[Redis] = None,
    redis_url: Optional[str] = None,
) -> Redis:
    if redis_client:
        return redis_client
    redis_url = redis_url if redis_url else os.getenv("REDIS_URL", "redis://redis:6379")
    return Redis.from_url(redis_url)  # type: ignore


async def ensure_redis_client(redis_client: Redis) -> None:
    assert redis_client, "Redis client is not initialized"
    if not await redis_client.ping():
        log.error("fail to ping redis")
        raise Exception("Redis instance is not available")


@dataclass
class StateVector:
    """Represents an aircraft position and state"""

    icao24: str
    registration: Optional[str] = None
    typecode: Optional[str] = None
    callsign: Optional[str] = None

    lastseen: float = 0
    firstseen: float = 0

    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None

    track: Optional[float] = None

    def to_json_dict(self) -> Dict[str, Any]:
        """Convert StateVector to a JSON-serializable dictionary"""
        return {
            "icao24": self.icao24,
            "registration": self.registration,
            "typecode": self.typecode,
            "callsign": self.callsign,
            "lastseen": self.lastseen,
            "firstseen": self.firstseen,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "altitude": self.altitude,
            "track": self.track,
        }

    def to_json_bytes(self) -> bytes:
        """Convert StateVector to JSON bytes"""
        return msgspec.json.encode(self.to_json_dict())

    @classmethod
    def from_json_dict(cls, data: Dict[str, Any]) -> "StateVector":
        """Create a StateVector from a dictionary"""
        return cls(
            icao24=data["icao24"],
            registration=data.get("registration"),
            typecode=data.get("typecode"),
            callsign=data.get("callsign"),
            lastseen=data.get("lastseen", 0),
            firstseen=data.get("firstseen", 0),
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            altitude=data.get("altitude"),
            track=data.get("track"),
        )

    @classmethod
    def from_json_bytes(cls, data: bytes) -> Optional["StateVector"]:
        """Create a StateVector from JSON bytes"""
        try:
            return cls.from_json_dict(msgspec.json.decode(data))
        except Exception as e:
            log.error(f"Error decoding state vector from bytes: {e}")
            return None


# StateVector = ForwardRef("StateVector")


@dataclass
class State:
    """
    Represents the current state of the subscriber
    Stores aircraft data in Redis for persistence and sharing
    Uses Redis Time Series for efficient time series data storage
    """

    def __init__(
        self,
        redis_client: Optional[Redis],
        redis_url: Optional[str] = None,
    ) -> None:
        """Initialize with a Redis client"""
        self.redis_client = create_redis_client(redis_client, redis_url)
        self.lastwrite_expiry: int | timedelta | None = 600
        self.history_expiry: int = 600
        self.write_interval: float = 60
        self.retention_msecs: int = self.history_expiry * 1000

    async def ensure_redis_client(self) -> None:
        await ensure_redis_client(self.redis_client)

    async def get_current(self, icao24: str) -> Optional[StateVector]:
        """Returns a specific aircraft by its ICAO24 address from Redis"""
        await self.ensure_redis_client()

        try:
            key = f"aircraft:current:{icao24}"
            data = await self.redis_client.get(key)
            return StateVector.from_json_bytes(data) if data else None
        except Exception as e:
            log.error(f"Error retrieving aircraft {icao24}: {e}")
            return None

    async def save_current(
        self,
        sv: StateVector,
        expiry_seconds: int | timedelta | None = 600,
    ) -> None:
        """Save aircraft data to Redis"""
        await self.ensure_redis_client()

        try:
            key = f"aircraft:current:{sv.icao24}"
            value = sv.to_json_bytes()
            await self.redis_client.set(key, value, ex=expiry_seconds)
        except Exception as e:
            log.error(f"Error saving aircraft {sv.icao24}: {e}")

    async def get_last_write_timestamp(self, icao24: str) -> float:
        """Get the last write time for an aircraft"""
        await self.ensure_redis_client()

        try:
            key = f"aircraft:lastwrite:{icao24}"
            data = await self.redis_client.get(key)
            return float(data.decode("utf-8")) if data else 0
        except Exception as e:
            log.error(f"Error retrieving last write time for {icao24}: {e}")
            return 0

    async def ensure_timeseries_exists(self, key: str, labels: Dict[str, str]) -> bool:
        """Ensure that a time series exists, create it if it doesn't"""
        await self.ensure_redis_client()

        try:
            # Check if the time series exists
            ts_client: TimeSeries = self.redis_client.ts()  # type: ignore
            _info = await ts_client.info(key)
            return True
        except Exception:
            # Create the time series
            try:
                # Filter out empty or None values from labels
                cleaned_labels = {k: v for k, v in labels.items() if v and v.strip()}

                # Ensure all label values are strings
                for k, v in cleaned_labels.items():
                    if not isinstance(v, str):
                        cleaned_labels[k] = str(v)

                await ts_client.create(
                    key, retention_msecs=self.retention_msecs, labels=cleaned_labels
                )
                log.debug(f"Created time series {key}")
                return True
            except Exception as e:
                log.error(f"Failed to create time series {key}: {e}")
                return False

    async def save_history(self, sv: StateVector) -> None:
        """Write the state vector to Redis Time Series"""
        await self.ensure_redis_client()

        # Check if we should record history based on write interval
        last_write_time = await self.get_last_write_timestamp(sv.icao24)
        if sv.lastseen - last_write_time < self.write_interval:
            return

        # Skip if no position data
        if sv.latitude is None or sv.longitude is None:
            return

        try:
            timestamp_ms = int(sv.lastseen * 1000)  # Convert to milliseconds
            ts_client: TimeSeries = self.redis_client.ts()  # type: ignore

            # Common labels for all time series for this aircraft
            # Prepare labels with non-empty values and convert all to strings
            common_labels = {}
            if sv.icao24:
                common_labels["icao24"] = sv.icao24
            if sv.registration and sv.registration.strip():
                common_labels["registration"] = sv.registration
            if sv.typecode and sv.typecode.strip():
                common_labels["typecode"] = sv.typecode
            if sv.callsign and sv.callsign.strip():
                common_labels["callsign"] = sv.callsign

            # Add position data to time series
            if sv.latitude is not None:
                lat_key = f"aircraft:ts:latitude:{sv.icao24}"
                await self.ensure_timeseries_exists(
                    lat_key, {**common_labels, "type": "latitude"}
                )
                await ts_client.add(lat_key, timestamp_ms, sv.latitude)

            if sv.longitude is not None:
                lon_key = f"aircraft:ts:longitude:{sv.icao24}"
                await self.ensure_timeseries_exists(
                    lon_key, {**common_labels, "type": "longitude"}
                )
                await ts_client.add(lon_key, timestamp_ms, sv.longitude)

            if sv.altitude is not None:
                alt_key = f"aircraft:ts:altitude:{sv.icao24}"
                await self.ensure_timeseries_exists(
                    alt_key, {**common_labels, "type": "altitude"}
                )
                await ts_client.add(alt_key, timestamp_ms, sv.altitude)

            if sv.track is not None:
                track_key = f"aircraft:ts:track:{sv.icao24}"
                await self.ensure_timeseries_exists(
                    track_key, {**common_labels, "type": "track"}
                )
                await ts_client.add(track_key, timestamp_ms, sv.track)

            # Update last write timestamp
            lastwrite_key = f"aircraft:lastwrite:{sv.icao24}"
            await self.redis_client.set(
                lastwrite_key, str(sv.lastseen), ex=self.lastwrite_expiry
            )

            log.debug(
                f"Stored history for {sv.icao24} at {sv.lastseen} using Time Series"
            )
        except Exception as e:
            log.error(f"Failed to store aircraft data in Redis Time Series: {e}")


# StateVector.__forward_arg__ = "StateVector"
# StateVector.__forward_evaluated__ = True


# TODO define type for msg
async def _get_state_vector(state: State, msg: Any) -> Optional[StateVector]:
    """try to find the StateVector from state, or create a new one"""
    if msg["df"] not in ["17", "18"]:
        return None

    if msg.get("bds") not in ["05", "06", "08", "09"]:
        return None

    icao24 = msg["icao24"]

    # Get or create state vector
    sv = await state.get_current(icao24)
    if not sv:
        now = datetime.now(timezone.utc).timestamp()

        # Look up aircraft information
        info = rs1090.aircraft_information(icao24)
        registration = info.get("registration", None)
        typecode = None

        # Create new state vector
        sv = StateVector(
            icao24=icao24,
            registration=registration,
            typecode=typecode,
            lastseen=now,
            firstseen=now,
        )

    # Update state vector with new information
    sv.lastseen = msg["timestamp"]

    if msg["df"] == "18":
        sv.typecode = "GRND"

    if "callsign" in msg:
        sv.callsign = msg["callsign"]

    if "altitude" in msg:
        sv.altitude = msg["altitude"]

    if "latitude" in msg:
        sv.latitude = msg["latitude"]

    if "longitude" in msg:
        sv.longitude = msg["longitude"]

    if "track" in msg:
        sv.track = msg["track"]
    return sv


class HistorySubscriber(redis.Subscriber[State]):
    """Subscriber for aircraft history recording using Redis"""

    def __init__(
        self,
        name: str,
        redis_url: str,
        channels: List[str],
        aggregation_interval: int = 60,
        history_expiry: int = 86400,
        state: Optional[State] = None,
    ):
        self.aggregation_interval = aggregation_interval
        self.history_expiry = history_expiry

        initial_state = state or State(redis_client=None, redis_url=redis_url)
        super().__init__(name, redis_url, channels, initial_state)

    async def subscribe(self) -> None:
        """Override to initialize Redis connection for state"""
        await super().subscribe()

    async def message_handler(
        self, event: str, payload: str, pattern: str, state: State
    ) -> None:
        # Skip messages that don't contain DF17 or DF18
        if '"17"' not in payload and '"18"' not in payload:
            return

        try:
            msg = msgspec.json.decode(payload)
            sv = await _get_state_vector(self.state, msg)
            if sv is None:
                return
            await self.state.save_current(sv)
            if sv.latitude is None and sv.longitude is None:
                return
            await self.state.save_history(sv)
        except Exception as e:
            log.error(f"Failed to process message: {e}")


class StateClient:
    """
    Client-side interface for interacting with aircraft state and history data
    Designed for use in REPL sessions or external applications
    """

    def __init__(
        self,
        redis_client: None | Redis = None,
        redis_url: None | str = None,
    ) -> None:
        self.redis_client = create_redis_client(redis_client, redis_url)

    async def ensure_redis_client(self) -> None:
        await ensure_redis_client(self.redis_client)

    async def get_aircraft_table(self) -> Dict[str, Any]:
        """Current aircraft table from Redis"""
        await self.ensure_redis_client()

        # Get all keys matching the aircraft pattern
        aircraft_keys = await self.redis_client.keys("aircraft:current:*")
        if not aircraft_keys:
            return {}

        # Get all aircraft data
        result = {}
        for key in aircraft_keys:
            icao24 = key.decode("utf-8").split(":")[-1]
            aircraft_data = await self.redis_client.get(key)
            if aircraft_data:
                aircraft_info = msgspec.json.decode(aircraft_data)
                result[icao24] = aircraft_info
        return result

    async def get_aircraft(self, icao24: str) -> Optional[Dict[str, Any]]:
        """A specific aircraft by its ICAO24 address from Redis"""
        await self.ensure_redis_client()
        data = await self.redis_client.get(f"aircraft:current:{icao24}")
        return msgspec.json.decode(data) if data else None

    async def get_aircraft_track(
        self,
        icao24: str,
        start_ts: Optional[float] = None,
        end_ts: Optional[float] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve the track (position history) of a specific aircraft using Time Series
        """
        await self.ensure_redis_client()
        ts_client: TimeSeries = self.redis_client.ts()  # type: ignore

        # Default to getting the most recent points if no time range specified
        from_time = "-" if start_ts is None else int(start_ts * 1000)
        to_time = "+" if end_ts is None else int(end_ts * 1000)

        # Get latitude, longitude, altitude, and track data
        results = {}
        track = []

        try:
            # Check if the time series exists for latitude (as a proxy for all data)
            lat_key = f"aircraft:ts:latitude:{icao24}"
            lon_key = f"aircraft:ts:longitude:{icao24}"
            alt_key = f"aircraft:ts:altitude:{icao24}"
            track_key = f"aircraft:ts:track:{icao24}"

            # Get data from all time series in parallel
            lat_data = await ts_client.range(lat_key, from_time, to_time, count=limit)
            lon_data = await ts_client.range(lon_key, from_time, to_time, count=limit)

            # Altitude and track may not exist for all points
            try:
                alt_data = await ts_client.range(
                    alt_key, from_time, to_time, count=limit
                )
            except:  # NOQA
                alt_data = []

            try:
                track_data = await ts_client.range(
                    track_key, from_time, to_time, count=limit
                )
            except:  # NOQA
                track_data = []

            # Organize data by timestamp
            for timestamp, value in lat_data:
                # Convert timestamp from milliseconds to seconds
                ts_sec = timestamp / 1000
                if ts_sec not in results:
                    results[ts_sec] = {"timestamp": ts_sec, "icao24": icao24}
                results[ts_sec]["latitude"] = value

            for timestamp, value in lon_data:
                ts_sec = timestamp / 1000
                if ts_sec not in results:
                    results[ts_sec] = {"timestamp": ts_sec, "icao24": icao24}
                results[ts_sec]["longitude"] = value

            for timestamp, value in alt_data:
                ts_sec = timestamp / 1000
                if ts_sec not in results:
                    results[ts_sec] = {"timestamp": ts_sec, "icao24": icao24}
                results[ts_sec]["altitude"] = value

            for timestamp, value in track_data:
                ts_sec = timestamp / 1000
                if ts_sec not in results:
                    results[ts_sec] = {"timestamp": ts_sec, "icao24": icao24}
                results[ts_sec]["track"] = value

            # Get aircraft metadata
            aircraft_data = await self.get_aircraft(icao24)
            if aircraft_data:
                for point in results.values():
                    point["registration"] = aircraft_data.get("registration")
                    point["typecode"] = aircraft_data.get("typecode")
                    point["callsign"] = aircraft_data.get("callsign")

            # Convert to list and sort by timestamp
            track = list(results.values())
            track.sort(key=lambda x: x["timestamp"])

        except Exception as e:
            log.error(f"Failed to get aircraft track from Time Series: {e}")

        return track

    async def get_current_positions(self) -> List[Dict[str, Any]]:
        await self.ensure_redis_client()
        aircraft_table = await self.get_aircraft_table()
        return [
            aircraft_data
            for aircraft_data in aircraft_table.values()
            if aircraft_data.get("latitude") is not None
            and aircraft_data.get("longitude") is not None
        ]

    async def get_aircraft_count(self) -> int:
        """Get the total number of aircraft being tracked"""
        await self.ensure_redis_client()
        keys = await self.redis_client.keys("aircraft:current:*")
        return len(keys)

    async def get_timeseries_info(self, icao24: str) -> Dict[str, Any]:
        """Get information about time series for an aircraft"""
        await self.ensure_redis_client()
        ts_client: TimeSeries = self.redis_client.ts()  # type: ignore

        result = {}
        try:
            keys = [
                f"aircraft:ts:latitude:{icao24}",
                f"aircraft:ts:longitude:{icao24}",
                f"aircraft:ts:altitude:{icao24}",
                f"aircraft:ts:track:{icao24}",
            ]

            for key in keys:
                try:
                    info = await ts_client.info(key)
                    result[key] = info
                except Exception:
                    pass

        except Exception as e:
            log.error(f"Failed to get time series info: {e}")

        return result

    async def get_timeseries_labels(self, icao24: str) -> Dict[str, Dict[str, str]]:
        """Get labels for time series for an aircraft"""
        await self.ensure_redis_client()
        ts_client: TimeSeries = self.redis_client.ts()  # type: ignore

        result = {}
        try:
            keys = [
                f"aircraft:ts:latitude:{icao24}",
                f"aircraft:ts:longitude:{icao24}",
                f"aircraft:ts:altitude:{icao24}",
                f"aircraft:ts:track:{icao24}",
            ]

            for key in keys:
                try:
                    info = await ts_client.info(key)
                    if "labels" in info:
                        result[key] = info["labels"]
                except Exception:
                    pass

        except Exception as e:
            log.error(f"Failed to get time series labels: {e}")

        return result


state = State(redis_client=None)
state_client = StateClient()
subscriber: Optional[HistorySubscriber] = None


async def startup(redis_url: str, channel: str, interval: int, expiry: int) -> None:
    """Start the subscriber"""
    global subscriber, state

    subscriber = HistorySubscriber(
        name="AircraftHistoryRecorder",
        redis_url=redis_url,
        channels=[channel],
        aggregation_interval=interval,
        history_expiry=expiry,
        state=state,
    )
    await subscriber.subscribe()

    # Wait for the subscriber task to complete
    try:
        await subscriber.task
    except asyncio.CancelledError:
        log.info("Subscriber task cancelled")
    finally:
        # Clean up subscriber
        if subscriber:
            await subscriber.cleanup()
            log.info("Subscriber cleaned up")


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Aircraft history recording service using Redis"
    )
    parser.add_argument(
        "--log-level",
        dest="log_level",
        default=os.getenv("LOG_LEVEL", "INFO"),
        help="Set the logging level",
    )
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
        help="Redis connection URL",
    )
    parser.add_argument(
        "--channel",
        dest="channel",
        default=os.getenv("JET1090_CHANNEL", "jet1090"),
        help="Redis channel for Jet1090 messages",
    )
    parser.add_argument(
        "--interval",
        dest="interval",
        type=int,
        default=60,
        help="Aggregation interval in seconds (default: 60 seconds)",
    )
    parser.add_argument(
        "--expiry",
        dest="expiry",
        type=int,
        default=600,
        help="History data expiry time in seconds (default: 10 minutes)",
    )

    args = parser.parse_args()
    log.setLevel(getattr(logging, args.log_level.upper(), logging.INFO))
    log.info(f"Starting aircraft history service with Redis at: {args.redis_url}")
    try:
        asyncio.run(startup(args.redis_url, args.channel, args.interval, args.expiry))
    except KeyboardInterrupt:
        log.info("Service stopped by user")
