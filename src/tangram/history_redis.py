import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, List, TYPE_CHECKING, ForwardRef

from redis.asyncio import Redis
import msgspec
import rs1090

from tangram.common import redis_subscriber


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)

StateVector = ForwardRef("StateVector")


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


@dataclass
class State:
    """
    Represents the current state of the subscriber
    Stores aircraft data in Redis for persistence and sharing
    """

    def __init__(self, redis_client=None, redis_url: Optional[str] = None):
        """Initialize with a Redis client (for backward compatibility)"""
        self.redis_client = create_redis_client(redis_client, redis_url)

    async def ensure_redis_client(self):
        await ensure_redis_client(self.redis_client)

    async def get_aircraft(self, icao24: str) -> Optional[StateVector]:
        """Returns a specific aircraft by its ICAO24 address from Redis"""
        if not self.redis_client:
            log.error("Redis client not initialized")
            return None

        try:
            key = f"aircraft:current:{icao24}"
            data = await self.redis_client.get(key)
            if data:
                return self._decode_state_vector(data)
            return None
        except Exception as e:
            log.error(f"Error retrieving aircraft {icao24}: {e}")
            return None

    async def save_aircraft(self, sv: StateVector) -> None:
        """Save aircraft data to Redis"""
        await self.ensure_redis_client()

        try:
            # Convert StateVector to JSON
            data = {
                "icao24": sv.icao24,
                "registration": sv.registration,
                "typecode": sv.typecode,
                "callsign": sv.callsign,
                "lastseen": sv.lastseen,
                "firstseen": sv.firstseen,
                "latitude": sv.latitude,
                "longitude": sv.longitude,
                "altitude": sv.altitude,
                "track": sv.track,
            }

            # Store in Redis
            key = f"aircraft:current:{sv.icao24}"
            await self.redis_client.set(key, msgspec.json.encode(data))

            # Optional: Set a reasonable expiry to auto-cleanup stale data
            await self.redis_client.expire(key, 3600)  # 1 hour
        except Exception as e:
            log.error(f"Error saving aircraft {sv.icao24}: {e}")

    async def get_last_write_time(self, icao24: str) -> float:
        """Get the last write time for an aircraft"""
        await self.ensure_redis_client()

        try:
            key = f"aircraft:lastwrite:{icao24}"
            data = await self.redis_client.get(key)
            if data:
                return float(data.decode("utf-8"))
            return 0
        except Exception as e:
            log.error(f"Error retrieving last write time for {icao24}: {e}")
            return 0

    async def set_last_write_time(self, icao24: str, timestamp: float) -> None:
        """Set the last write time for an aircraft"""
        if not self.redis_client:
            log.error("Redis client not initialized")
            return

        try:
            key = f"aircraft:lastwrite:{icao24}"
            await self.redis_client.set(key, str(timestamp))
            # Set expiry to match aircraft data
            await self.redis_client.expire(key, 3600)  # 1 hour
        except Exception as e:
            log.error(f"Error setting last write time for {icao24}: {e}")

    def _decode_state_vector(self, data: bytes) -> Optional[StateVector]:
        """Decode a state vector from Redis data"""
        try:
            sv_data = msgspec.json.decode(data)
            return StateVector(
                icao24=sv_data["icao24"],
                registration=sv_data.get("registration"),
                typecode=sv_data.get("typecode"),
                callsign=sv_data.get("callsign"),
                lastseen=sv_data.get("lastseen", 0),
                firstseen=sv_data.get("firstseen", 0),
                latitude=sv_data.get("latitude"),
                longitude=sv_data.get("longitude"),
                altitude=sv_data.get("altitude"),
                track=sv_data.get("track"),
            )
        except Exception as e:
            log.error(f"Error decoding state vector: {e}")
            return None


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


# StateVector.__forward_arg__ = "StateVector"
# StateVector.__forward_evaluated__ = True


class HistorySubscriber(redis_subscriber.Subscriber[State]):
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
            msg = msgspec.json.decode(payload)  # Parse the message
            await self.add_aircraft(msg)  # Process the aircraft data
        except Exception as e:
            log.error(f"Failed to process message: {e}")

    async def add_aircraft(self, msg: Dict[str, Any]) -> None:
        """Add or update aircraft data from a message"""
        # Skip messages that don't match criteria
        if msg["df"] not in ["17", "18"]:
            return

        if msg.get("bds") not in ["05", "06", "08", "09"]:
            return

        icao24 = msg["icao24"]

        # Get or create state vector
        sv = await self.state.get_aircraft(icao24)
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

        # Save updated state vector to Redis
        await self.state.save_aircraft(sv)

        # Store to Redis if enough time has passed since last write
        await self.maybe_write_to_redis(icao24, sv)

    async def maybe_write_to_redis(self, icao24: str, sv: StateVector) -> None:
        """Write aircraft data to Redis if aggregation interval has passed"""
        last_write_time = await self.state.get_last_write_time(icao24)

        # Only write to Redis if aircraft has position and enough time has passed
        if sv.latitude is not None and sv.longitude is not None:
            if sv.lastseen - last_write_time >= self.aggregation_interval:
                await self.store_in_redis(sv)
                await self.state.set_last_write_time(icao24, sv.lastseen)

    async def store_in_redis(self, sv: StateVector) -> None:
        """Write the state vector to Redis"""
        try:
            # Create a history entry as JSON
            history_entry = {
                "icao24": sv.icao24,
                "registration": sv.registration,
                "typecode": sv.typecode,
                "callsign": sv.callsign,
                "latitude": sv.latitude,
                "longitude": sv.longitude,
                "altitude": sv.altitude,
                "track": sv.track,
                "timestamp": sv.lastseen,
            }

            # Convert to JSON string
            entry_json = msgspec.json.encode(history_entry)

            # Create a Redis key for this entry using timestamp for ordering
            # Format: aircraft:history:{sv.icao24}:{sv.lastseen}, Stored with expiry
            history_key = f"aircraft:history:{sv.icao24}:{sv.lastseen}"
            await self.redis.set(history_key, entry_json, ex=self.history_expiry)

            # Add to a sorted set for efficient time-based querying
            timeline_key = f"aircraft:timeline:{sv.icao24}"
            await self.redis.zadd(timeline_key, {str(sv.lastseen): sv.lastseen})
            await self.redis.expire(timeline_key, self.history_expiry)

            log.debug(f"Stored history for {sv.icao24} at {sv.lastseen}")

        except Exception as e:
            log.error(f"Failed to store aircraft data in Redis: {e}")


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


"""
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
"""

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
        help="Aggregation interval in seconds",
    )
    parser.add_argument(
        "--expiry",
        dest="expiry",
        type=int,
        default=86400,
        help="History data expiry time in seconds (default: 24 hours)",
    )

    args = parser.parse_args()
    log.setLevel(getattr(logging, args.log_level.upper(), logging.INFO))
    log.info(f"Starting aircraft history service with Redis at: {args.redis_url}")
    try:
        asyncio.run(startup(args.redis_url, args.channel, args.interval, args.expiry))
    except KeyboardInterrupt:
        log.info("Service stopped by user")

    # LOG_LEVEL=DEBUG uv run python -m tangram.history_redis
