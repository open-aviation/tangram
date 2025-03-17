#!/usr/bin/env python
# coding: utf8

import asyncio
import json
import os
from dataclasses import dataclass
from typing import List
import logging

import redis.asyncio as redis

from tangram.plugins import redis_subscriber
from tangram.util import logging as tangram_logging

tangram_log = logging.getLogger(__name__)
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)


@dataclass
class State:
    pass


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        try:
            message_dict = json.loads(data)

            # put geospatial data in `planes` key
            pipe = self.redis.pipeline()
            key = "planes"
            values = [
                float(message_dict["longitude"]),
                float(message_dict["latitude"]),
                message_dict["icao24"],
            ]
            pipe.geoadd(key, values)
            pipe.expire(key, 60 * 1)  # always update expiry
            result = await pipe.execute()
            log.info("added to planes, (long/lat/icao24) %s, %s", values, result)
        except Exception:
            log.exception("error in message_handler")


subscriber: Subscriber | None = None


async def startup(redis_url: str):
    global subscriber

    subscriber = Subscriber("coordinate", redis_url, ["coordinate*"])
    await subscriber.subscribe()
    tangram_log.info("coordinate is up and running, check `planes` key at %s", redis_url)


async def shutdown():
    global subscriber

    if subscriber:
        await subscriber.cleanup()
    tangram_log.info("coordinate exits")


async def search_planes(redis_connection_pool, radius_km=12000, ref_latitude=0, ref_longitude=0):
    async with redis.Redis.from_pool(redis_connection_pool) as redis_client:
        await redis_client.ping()

        log.info("search by %s around (%s %s)", radius_km, ref_latitude, ref_longitude)
        planes = await redis_client.geosearch("planes", longitude=ref_longitude, latitude=ref_latitude, radius=radius_km, unit="km", withcoord=True)
        log.debug("plans[0]: %s", planes[0])

        return [{"icao24": icao24, "latitude": latitude, "longitude": longitude} for [icao24, [latitude, longitude]] in planes]


async def plane_history(redis_connection_pool, icao24: str):
    async with redis.Redis.from_pool(redis_connection_pool) as redis_client:
        await redis_client.ping()

        ts = redis_client.ts()
        lat = await ts.range(f"latitude:{icao24}", "-", "+")
        long = await ts.range(f"longitude:{icao24}", "-", "+")
        results = []
        for i in range(len(lat)):
            results.append({"timestamp": lat[i][0], "latitude": lat[i][1], "longitude": long[i][1]})
        return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("redis_url")
    args = parser.parse_args()
    asyncio.run(startup(args.redis_url))
