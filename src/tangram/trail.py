#!/usr/bin/env python
# coding: utf8

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Iterable, List

import msgspec

from tangram.common import redis_subscriber, rs1090
from tangram.history import HistoryDB

jet1090_restful_client = rs1090.Rs1090Client()
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)


@dataclass
class State:
    icao24: str | None = None
    trajectory: List[Iterable[float]] = field(default_factory=list)  #  lat, longi


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        self.redis_url: str = redis_url
        self.channels: List[str] = channels
        self.history_db = HistoryDB(use_memory=True)

        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(
        self, channel: str, data: str, pattern: str, state: State
    ):
        # log.info("selected: %s, got: %s %s", state.icao24, channel, data)

        if channel == "coordinate" and state.icao24:
            # log.info("selected: %s, coordinate data: %s", state.icao24, data)

            timed_message = msgspec.json.decode(data)
            if timed_message["icao24"] == state.icao24:
                icao24, latitude, longitude = (
                    timed_message["icao24"],
                    timed_message["latitude"],
                    timed_message["longitude"],
                )
                # await self.redis.publish("trajectory", msgspec.json.encode(timed_message))

                # Two options here:
                # 1. iddeally, we just push [lat, lng] point to UI. as long as the trajectory is properly cached
                # trajectory = [latitude, longitude]
                #
                # 2. full trajectory
                # history_trajectory = [[el["latitude"], el["longitude"]] for el in self.history_db.list_tracks(icao24)]
                # log.info("loaded history from %s", self.history_db.get_db_file())
                #
                # 3. fetch from jet1090 service
                records = await jet1090_restful_client.icao24_track(icao24) or []
                history_trajectory = [
                    [r.latitude, r.longitude]
                    for r in records
                    if r.latitude is not None and r.longitude is not None
                ]

                trajectory = history_trajectory  # + [[latitude, longitude]]
                await self.redis.publish(
                    f"to:trajectory-{state.icao24}:new-data",
                    msgspec.json.encode(trajectory),
                )
                log.info(
                    "redis `trajectory`, icao24: %s - latitude: %s, longitude: %s, len: %s",
                    state.icao24,
                    latitude,
                    longitude,
                    len(trajectory),
                )

        # Channels publish events. The topics are in the format of from:{channel}:{event}.
        if channel == "from:system:select":
            log.info("system select, data: %s", data)

            payload = msgspec.json.decode(data)
            icao24 = payload["icao24"]
            state.icao24 = icao24
            state.trajectory = [
                [el["latitude"], el["longitude"]]
                for el in self.history_db.list_tracks(icao24)
            ]
            log.info("select a different plane: %s", state.icao24)


subscriber: Subscriber | None = None


async def startup(redis_url: str):
    global subscriber

    log.info("trajectory is starting ...")
    channels = ["coordinate*", "from:system:*"]
    subscriber = Subscriber("trajectory", redis_url=redis_url, channels=channels)
    await subscriber.subscribe()

    log.info("trajectory is up and running ... %s", channels)
    try:
        await asyncio.get_event_loop().create_future()
    except asyncio.CancelledError:
        log.info("received shutdown signal")
    finally:
        log.info("trajectory is shutting down")
        await subscriber.cleanup()
        log.info("trajectory exits")


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
    )
    args = parser.parse_args()
    asyncio.run(startup(args.redis_url))
