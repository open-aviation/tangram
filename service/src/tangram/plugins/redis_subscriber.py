import asyncio
from typing import List, TypeVar, Generic
from redis.asyncio import Redis
from redis.asyncio.client import PubSub
from tangram.util import logging
import abc

log = logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)

StateT = TypeVar("StateT")


class Subscriber(abc.ABC, Generic[StateT]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state: StateT):
        self.name = name
        self.redis_url = redis_url
        self.channels = channels
        self.state: StateT = initial_state
        self.redis: Redis
        self.pubsub: PubSub
        self.task: asyncio.Task

    async def subscribe(self):
        self.redis: Redis = await Redis.from_url(self.redis_url)
        self.pubsub: PubSub = self.redis.pubsub()
        await self.pubsub.psubscribe(*self.channels)

        async def listen():
            try:
                log.info("%s listening ...", self.name)
                async for message in self.pubsub.listen():
                    if message["type"] == "pmessage":
                        await self.message_handler(
                            message["channel"].decode("utf-8"),
                            message["data"].decode("utf-8"),
                            message["pattern"],
                            self.state,
                        )
            except asyncio.CancelledError:
                log.warning("%s cancelled", self.name)

        self.task: asyncio.Task = asyncio.create_task(listen())
        log.info("%s task created, running ...", self.name)

    async def cleanup(self):
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

    @abc.abstractmethod
    async def message_handler(self, channel: str, data: str, pattern: str, state: StateT):
        pass

