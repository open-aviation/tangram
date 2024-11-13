import os
import asyncio
import json
import logging
from dataclasses import dataclass
from typing import List, Dict
import logging

# import redis.asyncio as redis
from tangram.plugins import redis_subscriber
from tangram.util import logging as tangram_logging

tangram_log = logging.getLogger(__name__)
log = tangram_logging.getPluginLogger(
    __package__, __name__, os.getenv("LOG_DIR"), log_level=logging.DEBUG, add_console_handler=False
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
            await self.redis.publish("altitude", json.dumps(record))  # altitude topic

        if "latitude" in message and "longitude" in message:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            message = {field: message[field] for field in fields}
            await self.redis.publish("coordinate", json.dumps(message))  # coordinate topic


async def startup(redis_url: str):
    log.info("starting filter_jet1090 ... (%s)", redis_url)

    # without this, when this function exits, everything is gone
    global asubscriber

    state = AState()
    asubscriber = ASubscriber("filter_jet1090", redis_url, ["jet1090-full*"], state)
    await asubscriber.subscribe()

    tangram_log.info("filter_jet1090 is up and running (jet1090-full* => coordinate, altitude)")

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

async def shutdown():
    tangram_log.info('filter_jet1090 exits')

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis")
    args = parser.parse_args()

    redis_url = os.getenv("REDIS_URL", args.redis)
    if not redis_url:
        print('please set environment variable "REDIS_URL" or use "--redis" option')
        exit(1)

    async def main(redis_url):
        try:
            await startup(redis_url)
        except Exception:
            print("\rbye.")

    asyncio.run(main(redis_url))
