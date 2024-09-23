import os
import asyncio
import json
import logging
from dataclasses import dataclass
from typing import List, Dict

import redis.asyncio as redis
from tangram.plugins import redis_subscriber
from tangram.util import logging


log = logging.getPluginLogger(
    __package__, __name__, os.getenv('LOG_DIR'), log_level=logging.DEBUG, add_console_handler=False
)


@dataclass
class AState:
    pass


class ASubscriber(redis_subscriber.Subscriber[AState]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state):
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: AState):
        message: Dict = json.loads(data)

        if "altitude" in message:
            fields = ["icao24", "timestamp", "altitude"]
            record = {field: message[field] for field in fields}
            await self.redis.publish("altitude", json.dumps(record))

        if "latitude" in message and "longitude" in message:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            message = {field: message[field] for field in fields}
            await self.redis.publish("jet1090", json.dumps(message))


async def startup(redis_url: str):
    log.info('starting filter_jet1090 ...')

    # without this, when this function exits, everything is gone
    global asubscriber

    state = AState()
    asubscriber = ASubscriber("filter_jet1090", redis_url, ["jet1090-full*"], state)
    await asubscriber.subscribe()

    log.info("filter_jet1090 is up and running, check `jet1090` topic at %s", redis_url)

    # As a plugin, a infinite loop will block FastAPI event loop: make it a task
    # in as independent task, we need this
    # try:
    #     while True:
    #         await asyncio.sleep(1)
    # except asyncio.CancelledError:
    #     print("\ruser interrupted, exiting ...")
    #
    #     log.info("coordinate is shutting down")
    #     await asubscriber.cleanup()
    #     log.info("coordinate exits")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", default="redis://localhost")
    args = parser.parse_args()

    try:
        asyncio.run(startup(args.redis_url))
    except KeyboardInterrupt:
        print("\rbye.")
