import asyncio
import json
import logging
import pathlib
from dataclasses import dataclass
from typing import Any, List

from redis.commands.timeseries import TimeSeries

from tangram.common import database, redis_subscriber

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)

DEFAULT_DB_DIRECTORY = pathlib.Path("/tmp")


@dataclass
class State:
    icao24: str | None = None


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(
        self,
        name: str,
        redis_url: str,
        channels: List[str],
        history_db: database.StateVectorDB,
    ):
        initial_state = State()
        self.history_db = history_db  # maybe put this into `state` ?
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(
        self, channel: str, data: str, pattern: str, state: State
    ) -> None:
        message = json.loads(data)
        # log.info("channel: %s, pattern: %s", channel, pattern)

        if channel == "coordinate":
            await self.coordinate_handler(message, state)

        if channel == "altitude":
            await self.altitude_handler(message, state)

    async def coordinate_handler(self, message: dict[str, Any], state: State) -> None:
        ts: TimeSeries = self.redis.ts()
        retention_msecs = 1000 * 60

        icao24 = message["icao24"]
        timestamp_ms = int(float(message["timestamp"]) * 1000)
        latitude, longitude = float(message["latitude"]), float(message["longitude"])
        record = {
            "icao24": icao24,
            "last": timestamp_ms,
            "latitude": latitude,
            "longitude": longitude,
            "altitude": None,  # no altitude from coordinate message
        }
        self.history_db.insert_tracks([record])
        log.debug("persiste record in db for %s", icao24)

        # EXPERIMENTAL: store latitude and longitude in redis timeseries
        latitude_key, longitude_key = f"latitude:{icao24}", f"longitude:{icao24}"
        labels = {
            "type": "latlong",
            "icao24": icao24,
        }
        if not await self.redis.exists(latitude_key):
            result = await ts.create(
                latitude_key, retention_msecs=retention_msecs, labels=labels
            )
            log.info("add latitude_key %s %s", latitude_key, result)

        if not await self.redis.exists(longitude_key):
            result = await ts.create(
                longitude_key, retention_msecs=retention_msecs, labels=labels
            )
            log.info("add longitude_key %s %s", longitude_key, result)

        fields = ["timestamp", "icao24", "latitude", "longitude"]
        message = {k: message[k] for k in fields}
        values = [
            (latitude_key, timestamp_ms, latitude),
            (longitude_key, timestamp_ms, longitude),
        ]
        await ts.madd(values)  # type: ignore

    async def altitude_handler(self, message: dict[str, Any], state: State) -> None:
        ts = self.redis.ts()
        retention_msecs = 1000 * 60

        icao24 = message["icao24"]
        timestamp_ms = int(float(message["timestamp"]) * 1000)

        if message["altitude"] is None:
            return

        altitude = float(message["altitude"])

        altitude_key = f"altitude:{icao24}"
        labels = {"type": "altitude", "icao24": icao24}
        if not await self.redis.exists(altitude_key):
            result = await ts.create(
                altitude_key, retention_msecs=retention_msecs, labels=labels
            )
            log.info("add key %s %s", altitude_key, result)

        fields = ["timestamp", "icao24", "altitude"]
        message = {k: message[k] for k in fields}
        values = [(altitude_key, timestamp_ms, altitude)]
        await ts.madd(values)  # type: ignore


sv_db: database.StateVectorDB | None = None
subscriber: Subscriber | None = None
load_task: asyncio.Task[Any] | None = None
expire_task: asyncio.Task[Any] | None = None


async def startup(
    redis_url: str, channels: List[str]
) -> List[asyncio.Task[Any] | None]:
    global sv_db, subscriber, load_task, expire_task
    log.info("history is starting ...")

    sv_db = database.StateVectorDB(use_memory=True)
    log.info(f"history db created: {sv_db.db_file}")

    log.info("history is loading historical data ... (this takes a few more seconds.)")
    await sv_db.load_all_history()
    log.info("history data loaded")

    expire_task = asyncio.create_task(sv_db.expire_records_periodically())
    log.info("tasks created, %s", expire_task.get_coro())

    load_task = asyncio.create_task(sv_db.load_by_restful_client())
    log.info("tasks created, %s", load_task.get_coro())

    # subscriber = Subscriber(name="history", redis_url=redis_url, channels=channels, history_db=history_db)
    # await subscriber.subscribe()
    # tangram_log.info("history is up and running, task: %s", subscriber.task.get_coro())
    # return [subscriber.task, load_task, expire_task]

    return [None, load_task, expire_task]


async def shutdown() -> None:
    log.info("history is shutting down ...")
    if load_task:
        load_task.cancel()
    if expire_task:
        expire_task.cancel()
    log.info("history exits")


async def main(redis_url: str, channel_csv: str = "coordinate,altitude*") -> None:
    channels = channel_csv.split(",")
    try:
        tasks = await startup(redis_url, channels=channels)
        # gather or wait for tasks
        await asyncio.gather(*[t for t in tasks if t is not None])
    except Exception as exec:
        log.exception(f"Error starting up history plugin: {exec}")
        await shutdown()


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        help="Redis url, or use REDIS_URL environment variable which take precedence, redis://host:port",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
    )
    parser.add_argument(
        "--redis-topic",
        dest="redis_topic_csv",
        help="Redis topics to linsten in CSV format, * allowed for patterns",
        default=os.getenv("REDIS_TOPIC", "coordinate,altitude*"),
    )
    args = parser.parse_args()
    asyncio.run(main(args.redis_url, args.redis_topic_csv))
