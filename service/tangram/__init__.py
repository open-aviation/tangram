import argparse
import configparser
import logging
import os
from pathlib import Path
from typing import Any, Callable

import anyio
from appdirs import user_config_dir
from redis.asyncio import Redis

config_dir = Path(user_config_dir("traffic"))
config_file = config_dir / "traffic.conf"
config_turb = configparser.ConfigParser()
config_turb.read(config_file.as_posix())


class Tangram:
    def __init__(self, name: str, redis_url: str | None = None):
        self.name = name

        parser = argparse.ArgumentParser()
        parser.add_argument("--redis-url", default=redis_url or os.getenv("REDIS_URL"))
        args = parser.parse_args()

        self.PREFIX: str = ""  # no ':' please

        logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
        self.logger = logging.getLogger(__name__)

        self.redis = Redis.from_url(args.redis_url)
        self.handlers: list[tuple[str, Callable]] = []
        self.nursery = None

    async def publish(self, channel: str, event: str, data: Any) -> None:
        await self.redis.publish(f"{self.PREFIX}to:{channel}:{event}", data)

    def handler(self, channel: str, event: str):
        def decorator(func):
            self.handlers.append((f"{self.PREFIX}from:{channel}:{event}", func))
            return func

        return decorator

    def task(self):
        tasks = []  # collect all tasks

        def decorator(func):
            tasks.append(func)
            return func

        if not hasattr(self, "_tasks"):
            self._tasks = []
        self._tasks.extend(tasks)
        return decorator

    async def _handle_messages(self, pubsub, handler_func):
        while True:
            message = await pubsub.get_message()
            if message and message["type"] == "message":
                await handler_func(message["data"])

    async def run(self):
        async with anyio.create_task_group() as tg:
            self.nursery = tg

            # start tasks
            for task in getattr(self, "_tasks", []):
                tg.start_soon(task)

            # start handlers
            for channel, func in self.handlers:
                pubsub = self.redis.pubsub()
                await pubsub.subscribe(channel)
                tg.start_soon(self._handle_messages, pubsub, func)
