import abc
import asyncio
from typing import List, TypeVar, Generic

import redis
from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from tangram.util import logging


log = logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)

StateT = TypeVar("StateT")


class Subscriber(abc.ABC, Generic[StateT]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state: StateT):
        self.name = name
        self.redis_url: str = redis_url
        self.channels: List[str] = channels
        self.state: StateT = initial_state
        self.redis: Redis | None = None
        self.pubsub: PubSub | None = None
        self.task: asyncio.Task | None = None
        self._running = False

    async def subscribe(self):
        if self._running:
            log.warning("%s already running", self.name)
            return

        try:
            self.redis = await Redis.from_url(self.redis_url)
            self.pubsub = self.redis.pubsub()
            await self.pubsub.psubscribe(*self.channels)
        except redis.exceptions.RedisError as e:
            log.error("%s failed to connect to Redis: %s", self.name, e)
            raise

        async def listen():
            try:
                log.info("%s listening ...", self.name)
                async for message in self.pubsub.listen():
                    log.info("message: %s", message)
                    if message["type"] == "pmessage":
                        await self.message_handler(
                            message["channel"].decode("utf-8"),
                            message["data"].decode("utf-8"),
                            message["pattern"].decode("utf-8"),
                            self.state,
                        )
            except asyncio.CancelledError:
                log.warning("%s cancelled", self.name)

        self._running = True

        self.task: asyncio.Task = asyncio.create_task(listen())
        log.info("%s task created, running ...", self.name)

    async def cleanup(self):
        if not self._running:
            return

        if self.task:
            log.debug("%s canceling task ...", self.name)
            self.task.cancel()
            try:
                log.debug("%s await task to finish ...", self.name)
                await self.task
                log.debug("%s task canceled", self.name)
            except asyncio.CancelledError as exc:
                log.error("%s task canceling error: %s", self.name, exc)
        if self.pubsub:
            await self.pubsub.unsubscribe()
        if self.redis:
            await self.redis.close()
        self._running = False

    def is_active(self) -> bool:
        """Return True if the subscriber is actively listening."""
        return self._running and self.task is not None and not self.task.done()

    @abc.abstractmethod
    async def message_handler(self, event: str, payload: str, pattern: str, state: StateT):
        pass
