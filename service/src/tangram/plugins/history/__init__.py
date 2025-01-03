#!/usr/bin/env python
# coding: utf8

import asyncio
import json
import logging
from asyncio.tasks import Task
from dataclasses import dataclass
from typing import List, Sequence

from redis.commands.timeseries import TimeSeries

from tangram.plugins import redis_subscriber
from tangram.util import logging as tangram_logging

from .storage import HistoryDB

tangram_log = logging.getLogger("tangram")
# log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.INFO)
log = tangram_log


@dataclass
class State:
    icao24: str | None = None


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str], history_db: HistoryDB):
        initial_state = State()
        self.history_db = history_db  # maybe put this into `state` ?
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        message = json.loads(data)
        # log.info("channel: %s, pattern: %s", channel, pattern)

        if channel == "coordinate":
            await self.coordinate_handler(message, state)

        if channel == "altitude":
            await self.altitude_handler(message, state)

    async def coordinate_handler(self, message: dict, state: State):
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
        self.history_db.insert_many_tracks([record])
        log.debug("persiste record in db for %s", icao24)

        # EXPERIMENTAL: store latitude and longitude in redis timeseries
        latitude_key, longitude_key = f"latitude:{icao24}", f"longitude:{icao24}"
        labels = {
            "type": "latlong",
            "icao24": icao24,
        }
        if not await self.redis.exists(latitude_key):
            result = await ts.create(latitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add latitude_key %s %s", latitude_key, result)

        if not await self.redis.exists(longitude_key):
            result = await ts.create(longitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add longitude_key %s %s", longitude_key, result)

        fields = ["timestamp", "icao24", "latitude", "longitude"]
        message = {k: message[k] for k in fields}
        values: Sequence = [
            (latitude_key, timestamp_ms, latitude),
            (longitude_key, timestamp_ms, longitude),
        ]
        await ts.madd(values)

    async def altitude_handler(self, message: dict, state: State):
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
            result = await ts.create(altitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add key %s %s", altitude_key, result)

        fields = ["timestamp", "icao24", "altitude"]
        message = {k: message[k] for k in fields}
        values: Sequence = [(altitude_key, timestamp_ms, altitude)]
        await ts.madd(values)


subscriber: Subscriber | None = None
load_task: asyncio.Task | None = None
expire_task: asyncio.Task | None = None


async def startup(redis_url: str) -> List[asyncio.Task]:
    global subscriber, load_task, expire_task
    tangram_log.info("history is starting ...")

    global subscriber, load_task, expire_task

    history_db = HistoryDB(use_memory=False)
    tangram_log.info("history db created, use_memory: %s", history_db)

    tangram_log.info("history is loading historical data ... (this takes a few more seconds.)")
    await history_db.load_all_history()
    tangram_log.info("history data loaded")

    expire_task = asyncio.create_task(history_db.expire_records_periodically())
    tangram_log.info("tasks created, %s", expire_task.get_coro())

    load_task = asyncio.create_task(history_db.load_by_restful_client())
    tangram_log.info("tasks created, %s", load_task.get_coro())

    subscriber = Subscriber(name="history", redis_url=redis_url, channels=["coordinate", "altitude*"], history_db=history_db)
    await subscriber.subscribe()
    tangram_log.info("history is up and running, task: %s", subscriber.task.get_coro())
    return [subscriber.task, load_task, expire_task]


async def shutdown():
    tangram_log.info("history is shutting down ...")
    if load_task:
        load_task.cancel()
    if expire_task:
        expire_task.cancel()
    tangram_log.info("history exits")
