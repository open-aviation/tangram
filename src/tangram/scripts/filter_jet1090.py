import asyncio
import json
import logging
from dataclasses import dataclass
from typing import List

from tangram.plugins import redis_subscriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


@dataclass
class State:
    pass


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        m = json.loads(data)


async def main(redis_url: str):
    subscriber = Subscriber("coordinate", redis_url, ["jet1090*"])
    await subscriber.subscribe()
    log.info("coordinate is up and running")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", default="redis://localhost")
    args = parser.parse_args()

    asyncio.run(main(args.redis_url))
