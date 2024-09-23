#!/usr/bin/env python
# coding: utf8

import asyncio
from dataclasses import dataclass
import json
from logging import logMultiprocessing
from typing import List, Sequence

from tangram.plugins import redis_subscriber
from tangram.plugins.common.rs1090 import Jet1090Data
from tangram.plugins.common.rs1090.websocket_client import ClientChannel, jet1090_websocket_client
from tangram.util import logging

from .storage import HistoryDB

log = logging.getPluginLogger(__package__, __name__, "/tmp/tangram", log_level=logging.DEBUG)


# def on_system_joining(join_ref, ref, channel, event, status, response):
#     log.info("HISTORY, `%s`, join, %s %s %s %s", channel, join_ref, ref, status, response)
#
#
# def on_system_datetime(join_ref, ref, channel, event, status, response):
#     log.info("HISTORY, `%s`, datetime, %s %s %s %s", channel, join_ref, ref, status, response)
#
#
# system_channel = jet1090_websocket_client.add_channel("system")
# system_channel.on_event("join", on_system_joining)
# system_channel.on_event("datetime", on_system_datetime)

load_task: asyncio.Task | None = None
expire_task: asyncio.Task | None = None


async def startup():
    global load_task, expire_task
    # asyncio.create_task(system_channel.join_async())
    log.debug("creating db")
    history_db = HistoryDB(use_memory=False)

    log.debug("loading history data")
    await history_db.load_all_history()

    log.debug("creating tasks")
    expire_task = asyncio.create_task(history_db.expire_records_periodically())
    load_task = asyncio.create_task(history_db.load_by_restful_client())

    log.info("history tasks are up & running ...")


async def start_with_ws():
    # FIXME: two plugins subscribing to the same channel, not join_ref in response
    history_db = HistoryDB(use_memory=False)
    await history_db.load_all_history()
    asyncio.create_task(history_db.expire_records_periodically())

    async def on_jet1090_data(join_ref, ref, channel, event, status, response):
        timed_message = response.get("timed_message")
        # log.debug("got data %s", timed_message)

        item = Jet1090Data(**timed_message)
        # log.debug("item: %s", item)

        if item.icao24 and item.last:
            if item.latitude is None and item.longitude is None:
                pass
            else:
                log.debug("%s, first     : %s", join_ref, item)
                if item.latitude and item.longitude:
                    history_db.insert_many_tracks([item])
                    log.debug("%s, trajectory: %s", join_ref, item)
                    log.debug("----")

                if item.altitude:
                    history_db.insert_many_altitudes([item])
                    # log.debug("altitude: %s", item)

    data_source_channel: ClientChannel = jet1090_websocket_client.add_channel("jet1090")
    data_source_channel.on_event("data", on_jet1090_data)
    asyncio.create_task(data_source_channel.join_async())

    log.info("history joins jet1090 channel")


@dataclass
class State:
    icao24: str | None = None


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        message = json.loads(data)
        # log.info("channel: %s, pattern: %s", channel, pattern)

        if channel == "coordinate":
            await self.coordinate_handler(message, state)

        if channel == "altitude":
            await self.altitude_handler(message, state)

    async def coordinate_handler(self, message: dict, state: State):
        ts = self.redis.ts()
        retention_msecs = 1000 * 60

        icao24 = message["icao24"]
        timestamp_ms = int(float(message["timestamp"]) * 1000)
        latitude, longitude = float(message["latitude"]), float(message["longitude"])

        latitude_key, longitude_key = f"latitude:{icao24}", f"longitude:{icao24}"
        labels = {
            "type": "latlong",
            "icao24": icao24,
        }
        if not await self.redis.exists(latitude_key):
            result = await ts.create(latitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add key %s %s", latitude_key, result)

        if not await self.redis.exists(longitude_key):
            result = await ts.create(longitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("adde key %s %s", longitude_key, result)

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


async def startup_redis(redis_url: str):
    global subscriber

    subscriber = Subscriber(name="history", redis_url=redis_url, channels=["coordinate", "altitude*"])
    await subscriber.subscribe()


async def shutdown():
    if load_task:
        load_task.cancel()
    if expire_task:
        expire_task.cancel()
    log.info("plugin history exits")
