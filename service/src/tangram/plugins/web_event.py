import logging
import asyncio
import json
from typing import Callable, List, Tuple

from redis.asyncio import Redis
from redis.asyncio.client import PubSub


from tangram.util import logging as tangram_logging
import tangram.websocket as channels

tangram_log = logging.getLogger(__name__)
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)


async def default_message_handler(message):
    channel = message["channel"].decode("utf-8")
    data = message["data"].decode("utf-8")
    log.debug("from [%s]: %s", channel, data)

    # dispatch event
    if channel == "channel:table:event:flight-hover":
        data = json.loads(data)
        # ACK
        # await channels.system_broadcast(channel="channel:table", event="flight-hover", data=data)
        await channels.system_broadcast(channel="channel:streaming", event="new-selected", data=data[-1])


async def create_redis_subscriber(
    redis_url: str, channels: List[str], message_handler: Callable = default_message_handler
) -> Tuple[asyncio.Task, PubSub, Redis]:
    redis: Redis = await Redis.from_url(redis_url)

    pubsub: PubSub = redis.pubsub()
    await pubsub.psubscribe(*channels)

    async def listen():
        try:
            async for message in pubsub.listen():
                if message["type"] == "pmessage":
                    await message_handler(message)
        except asyncio.CancelledError:
            log.warning("web events subscription is canncelled")
        finally:
            log.warning("cleanup ...")
            await pubsub.unsubscribe()
            await redis.close()
            log.info("redis and pubsub subscriber exits.")

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
subscriber_pubsub: None | PubSub = None
subscriber_redis: None | Redis = None


async def startup(redis_url: str):
    global subscriber_task, subscriber_pubsub, subscriber_redis

    channels = ["channel:system:*", "channel:table:*"]
    subscriber_task, subscriber_pubsub, subscriber_redis = await create_redis_subscriber(redis_url, channels)
    tangram_log.info("web_event is up and running.")


async def shutdown():
    global subscriber_task, subscriber_pubsub, subscriber_redis

    if subscriber_task:
        await cleanup_redis_subscriber(subscriber_task, subscriber_pubsub, subscriber_redis)
        subscriber_task = subscriber_pubsub = subscriber_redis = None
    tangram_log.info("web_event exits")
