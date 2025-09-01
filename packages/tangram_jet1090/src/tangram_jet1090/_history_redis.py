#!/usr/bin/env python
# coding: utf8

"""
!!! warning
    deprecated, use `tangram_history` instead.

Redis-based Aircraft History Tracking System
===========================================

This module implements an aircraft tracking system that uses Redis for state management
and historical data storage. It subscribes to aircraft messages, processes them, and
maintains both current state and historical positions of aircraft.


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

3. Historical Position Data:
   - Key: `aircraft:history:{icao24}:{timestamp}`
   - Value: JSON encoded position history entry
   - TTL: Configurable (default 10 minutes)
   - Purpose: Stores individual position reports for historical tracks

4. Timeline Index:
   - Key: `aircraft:timeline:{icao24}`
   - Value: Sorted set mapping timestamps to scores
   - TTL: Configurable (default 10 minutes)
   - Purpose: Provides efficient time-based queries for aircraft tracks

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

$ LOG_LEVEL=DEBUG uv run python -m tangram.history_redis

- From Python REPL:

Use one of the following methods to start a REPL:

- python -m asyncio
- ipython with %autoawait
- uv run ipython

from tangram import history_redis

# Create a client to interact with the aircraft data
# if you REDIS_URL is set in environmental variable, you are good to go
client = history_redis.StateClient()

# Get current aircraft
count = await client.get_aircraft_count()
aircraft = await client.get_aircraft_table()

# Get track for a specific aircraft
track = await client.get_aircraft_track("a0b1c2")

# Get summary of active aircraft
positions = await client.get_current_positions()

Useful Redis Commands:
---------------------
Use redis-cli or iredis

Basic Operations:
- Get all keys for a pattern: `KEYS aircraft:*`
- Get a specific aircraft state: `GET aircraft:current:{icao24}`
- Check TTL for a key: `TTL aircraft:current:{icao24}`
- Delete a key: `DEL aircraft:current:{icao24}`

Sorted Set Operations (Timeline):
- Get all timestamps for an aircraft: `ZRANGE aircraft:timeline:{icao24} 0 -1 WITHSCORES`
- Get timestamps in a time range: `ZRANGEBYSCORE aircraft:timeline:{icao24} {min_time} {max_time}`
- Count entries in timeline: `ZCARD aircraft:timeline:{icao24}`
- Remove entries by timestamp: `ZREMRANGEBYSCORE aircraft:timeline:{icao24} {min_time} {max_time}`

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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import msgspec
import rs1090
from redis.asyncio import Redis
from tangram import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


def create_redis_client(
    redis_client: Optional[Redis] = None, redis_url: Optional[str] = None
) -> Redis:
    if redis_client:
        return redis_client
    if redis_url:
        return Redis.from_url(redis_url)
    return Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379"))


async def ensure_redis_client(redis_client: Redis):
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
    """

    def __init__(self, redis_client=None, redis_url: Optional[str] = None):
        """Initialize with a Redis client (for backward compatibility)"""
        self.redis_client = create_redis_client(redis_client, redis_url)
        self.lastwrite_expiry: float = 600
        self.history_expiry: int = 600
        self.write_interval: float = 60

    async def ensure_redis_client(self):
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

    async def save_current(self, sv: StateVector, expiry_seconds: float = 600) -> None:
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

    async def save_history(self, sv: StateVector) -> None:
        """Write the state vector to Redis"""
        await self.ensure_redis_client()

        last_write_time = await self.get_last_write_timestamp(sv.icao24)
        if sv.lastseen - last_write_time < self.write_interval:
            return

        try:
            history_dict = sv.to_json_dict()
            history_dict["timestamp"] = sv.lastseen

            entry_json = msgspec.json.encode(history_dict)

            # Create a Redis key for this entry using timestamp for ordering
            history_key = f"aircraft:history:{sv.icao24}:{sv.lastseen}"
            await self.redis_client.set(history_key, entry_json, ex=self.history_expiry)

            # Add to a sorted set for efficient time-based querying
            timeline_key = f"aircraft:timeline:{sv.icao24}"
            await self.redis_client.zadd(timeline_key, {str(sv.lastseen): sv.lastseen})
            await self.redis_client.expire(timeline_key, self.history_expiry)

            lastwrite_key = f"aircraft:lastwrite:{sv.icao24}"
            await self.redis_client.set(
                lastwrite_key, str(sv.lastseen), ex=self.lastwrite_expiry
            )

            log.debug(f"Stored history for {sv.icao24} at {sv.lastseen}")
        except Exception as e:
            log.error(f"Failed to store aircraft data in Redis: {e}")


# StateVector.__forward_arg__ = "StateVector"
# StateVector.__forward_evaluated__ = True


async def _get_state_vector(state: State, msg) -> Optional[StateVector]:
    """try to find the StateVector from state, or create a new one"""
    if msg["df"] not in ["17", "18"]:
        return

    if msg.get("bds") not in ["05", "06", "08", "09"]:
        return

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

        initial_state = state or State(redis_url=redis_url)
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

    def __init__(self, redis_client=None, redis_url=None):
        self.redis_client = create_redis_client(redis_client, redis_url)

    async def ensure_redis_client(self):
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
        Retrieve the track (position history) of a specific aircraft
        """
        await self.ensure_redis_client()

        timeline_key = f"aircraft:timeline:{icao24}"
        if not await self.redis_client.exists(timeline_key):
            return []

        # Default to getting the most recent points if no time range specified
        end_ts = float("inf") if end_ts is None else end_ts
        start_ts = float("-inf") if start_ts is None else start_ts

        # Get timestamps sorted by time (ascending)
        timestamps = await self.redis_client.zrangebyscore(
            timeline_key,
            min=start_ts,
            max=end_ts,
            start=0,
            num=limit,
            withscores=True,
            score_cast_func=float,
        )

        if not timestamps:
            return []

        # For each timestamp, get the corresponding history entry
        track = []
        for _, ts in timestamps:
            history_key = f"aircraft:history:{icao24}:{ts}"
            entry_data = await self.redis_client.get(history_key)

            if entry_data:
                try:
                    entry = msgspec.json.decode(entry_data)
                    track.append(entry)
                except Exception as e:
                    log.error(f"Failed to decode history entry: {e}")
        return track

    async def get_current_positions(self) -> List[Dict[str, Any]]:
        await self.ensure_redis_client()
        aircraft_table = await self.get_aircraft_table()
        return [
            aircraft_data
            for aircraft_data in aircraft_table.values()
            if aircraft_data.get("latitude") is not None
            and aircraft_data.get("longitude") is not None
            # and last seen with in 60 seconds?
        ]

    async def get_aircraft_count(self) -> int:
        """Get the total number of aircraft being tracked"""
        await self.ensure_redis_client()
        keys = await self.redis_client.keys("aircraft:current:*")
        return len(keys)


state = State()
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
