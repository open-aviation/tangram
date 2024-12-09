import os
import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import List, Dict

# import redis.asyncio as redis
from tangram.plugins import redis_subscriber
from tangram.util import logging as tangram_logging

# tangram_log = logging.getLogger(__name__)
# log = tangram_logging.getPluginLogger(__package__, __name__, os.getenv("LOG_DIR"), log_level=logging.DEBUG, add_console_handler=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(lineno)s - %(message)s")
log = logging.getLogger(__name__)
tangram_log = log


@dataclass
class AState:
    last_published_timestamp: dict[str, float] = field(default_factory=lambda: dict())  # icao24 => timestamp


class ASubscriber(redis_subscriber.Subscriber[AState]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state, publish_topic, limiting_interval_sec=5):
        self.publish_topic = publish_topic
        self.limiting_interval_sec = limiting_interval_sec

        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: AState):
        message: Dict = json.loads(data)

        if "latitude" in message and "longitude" in message:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            message = {field: message[field] for field in fields}

            icao24, ts = message["icao24"], message["timestamp"]
            last_ts = state.last_published_timestamp.get(icao24, 0)

            if ts - last_ts < self.limiting_interval_sec:
                # log.debug("rate_limited: %s, ts: %22.9f, last_ts: %22.9f, interval: %s", icao24, ts, last_ts, ts - last_ts)
                return

            message["last_timestamp"] = last_ts
            await self.redis.publish(self.publish_topic, json.dumps(message))
            state.last_published_timestamp[icao24] = ts

            log.debug("published: %s, ts: %22.9f, last_ts: %22.9f, interval: %s", icao24, ts, last_ts, ts - last_ts)


asubscriber = None


async def startup(redis_url: str, src_topic: str = "jet1090-full*", dest_topic: str = "coordinate-rate-limited"):
    log.info("starting rate_limiting ... (%s)", redis_url)

    global asubscriber

    state = AState()
    asubscriber = ASubscriber("rate_limiting", redis_url, [src_topic], state, dest_topic, limiting_interval_sec=5)
    await asubscriber.subscribe()

    tangram_log.info("rate_limiting is up and running ... (%s => %s)", src_topic, dest_topic)
    log.debug("task: %s", asubscriber.task)
    await asyncio.wait([asubscriber.task])


async def shutdown():
    tangram_log.info("rate_limiting exits")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis")
    parser.add_argument("--src-topic", type=str, dest="src_topic", default="jet1090-full*")
    parser.add_argument("--dest-topic", type=str, dest="dest_topic", default="coordinate-rate-limited")
    args = parser.parse_args()

    redis_url = os.getenv("REDIS_URL", args.redis)
    if not redis_url:
        print('please set environment variable "REDIS_URL" or use "--redis" option')
        exit(1)

    async def main(redis_url):
        try:
            await startup(redis_url, src_topic=args.src_topic, dest_topic=args.dest_topic)
        except Exception:
            print("\rbye.")

    asyncio.run(main(redis_url))
