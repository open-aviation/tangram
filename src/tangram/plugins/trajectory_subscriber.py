import json
import os
from dataclasses import dataclass
from typing import List

from tangram.plugins import redis_subscriber
from tangram.util import logging

log = logging.getPluginLogger(__package__, __name__, os.getenv("LOG_DIR"), log_level=logging.INFO)


@dataclass
class State:
    icao24: str | None = None


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        if channel == "coordinate" and state.icao24:
            log.debug("coordinate data: %s", data)
            timed_message = json.loads(data)
            if timed_message["icao24"] == state.icao24:
                latitude, longitude = timed_message["latitude"], timed_message["longitude"]
                log.info("%s - latitude: %s, longitude: %s", state.icao24, latitude, longitude)
                await self.redis.publish("trajectory", json.dumps(timed_message))

        if channel == "channel:system:select":
            log.debug("system select, data: %s", data)
            message_list = json.loads(data)
            if len(message_list) != 5:
                log.warning("message_list: %s", message_list)
                return

            [ref, join_ref, channel, event, payload] = message_list
            log.debug("channel: %s, event: %s, payload: %s", channel, event, payload)

            state.icao24 = payload["icao24"]
            log.info("select a different plane: %s", state.icao24)


subscriber: Subscriber | None = None


async def startup(redis_url: str):
    global subscriber

    subscriber = Subscriber("trajectory_subscriber", redis_url=redis_url, channels=["coordinate", "channel:system:*"])
    await subscriber.subscribe()


async def shutdown():
    global subscriber

    if subscriber:
        await subscriber.cleanup()
