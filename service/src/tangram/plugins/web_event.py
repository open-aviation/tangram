import logging
import asyncio
from typing import Callable, List

from redis.asyncio import Redis

from tangram.util import logging as tangram_logging

tangram_log = logging.getLogger(__name__)
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)


async def default_message_handler(message):
    channel = message["channel"].decode("utf-8")
    data = message["data"].decode("utf-8")
    log.debug("from [%s]: %s", channel, data)


async def create_redis_subscriber(
    redis_url: str, channels: List[str], message_handler: Callable = default_message_handler
):
    redis = await Redis.from_url(redis_url)
    pubsub = redis.pubsub()
    await pubsub.psubscribe(*channels)

    async def listen():
        try:
            async for message in pubsub.listen():
                if message["type"] == "pmessage":
                    await message_handler(message)
        except asyncio.CancelledError:
            log.info("canncelled")
        finally:
            log.info("cleanup ...")
            await pubsub.unsubscribe()
            await redis.close()
            log.info("subscriber closed")

    task = asyncio.create_task(listen())
    return task, pubsub, redis


async def cleanup_redis_subscriber(task, pubsub, redis):
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        log.info("task cancelled")
    await pubsub.unsubscribe()
    await redis.close()
    log.info("subscriber exits.")


subscriber_task: None | asyncio.Task[None] = None
subscriber_pubsub: None | asyncio.Task[None] = None
subscriber_redis: None | asyncio.Task[None] = None


async def startup(redis_url: str):
    global subscriber_task, subscriber_pubsub, subscriber_redis

    channels = ["channel:system:*"]
    subscriber_task, subscriber_pubsub, subscriber_redis = await create_redis_subscriber(redis_url, channels)
    tangram_log.info("web_event is up and running.")


async def shutdown():
    global subscriber_task, subscriber_pubsub, subscriber_redis

    if subscriber_task:
        await cleanup_redis_subscriber(subscriber_task, subscriber_pubsub, subscriber_redis)
        subscriber_task = subscriber_pubsub = subscriber_redis = None
    tangram_log.info("web_event exits")
