import os
import asyncio
import msgspec
import logging
from dataclasses import dataclass
from typing import List, Dict

from tangram.plugins import redis_subscriber


logging.basicConfig(level=logging.DEBUG, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


@dataclass
class AState:
    pass


class ASubscriber(redis_subscriber.Subscriber[AState]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state):
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: AState):
        message: Dict = msgspec.json.decode(data)

        if "altitude" in message:
            fields = ["icao24", "timestamp", "altitude"]
            record = {field: message[field] for field in fields}
            await self.redis.publish("altitude", msgspec.json.encode(record))  # altitude topic

        if "latitude" in message and "longitude" in message:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            message = {field: message[field] for field in fields}
            await self.redis.publish("coordinate", msgspec.json.encode(message))  # coordinate topic


asubscriber = None


async def startup(
    redis_url: str,
    source_topic: str = "jet1090-full",
):
    log.info("starting filter ... (%s)", redis_url)

    # without this, when this function exits, everything is gone
    global asubscriber

    state = AState()
    asubscriber = ASubscriber("filter ", redis_url, [source_topic], state)
    await asubscriber.subscribe()

    log.info("filter is up and running (jet1090-full* => coordinate, altitude)")
    try:
        # 等待终止信号
        await asyncio.get_event_loop().create_future()  # 永久等待直到收到信号
    except asyncio.CancelledError:
        log.info("received shutdown signal")
    finally:
        log.info("coordinate is shutting down")
        await asubscriber.cleanup()
        log.info("coordinate exits")


if __name__ == "__main__":
    import os
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", dest="redis_url", default=os.getenv("REDIS_URL", "redis://redis:6379"))
    parser.add_argument("--redis-topic", dest="source_topic", help="source topic for jet1090 data", default="jet1090-full")
    args = parser.parse_args()

    asyncio.run(startup(args.redis_url))
