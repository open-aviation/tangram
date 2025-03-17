from __future__ import annotations

import json
import logging
import os
from typing import Any, List

import redis
import redis.exceptions
from broadcaster import Broadcast
from fastapi import WebSocket
from pydantic import BaseModel
from starlette.concurrency import run_until_first_complete

from tangram.util import logging as tangram_logging

# log = logging.getLogger(__name__)
tangram_log = logging.getLogger("tangram")
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)

redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")
tangram_log.info("websocket is using redis_url: %s", redis_url)

broadcast = Broadcast(redis_url)
redis_client = redis.from_url(redis_url)
pubsub = redis_client.pubsub(ignore_subscribe_messages=True)


class Hub:
    def __init__(self) -> None:
        self._channel_clients: dict[str, set[str]] = {}  # channel -> {clients}
        self._client_attributes: dict[str, dict[str, str]] = {}  # client attributes

    def _client_health_check(self, client_id: str):
        raise NotImplementedError

    def add(self, client_id: str, channel: str) -> None:
        if channel not in self._channel_clients:
            self._channel_clients[channel] = set()
        self._channel_clients[channel].add(client_id)
        log.info("client %s added into channel %s", client_id, channel)

    def remove(self, client_id: str, channel: str) -> None:
        if channel in self._channel_clients:
            self._channel_clients[channel].discard(client_id)
            log.info("client %s removed from channel %s", client_id, channel)

    def channel_clients(self) -> dict[str, set[str]]:
        return self._channel_clients

    def channels(self) -> List[str]:
        return list(self.channel_clients().keys())

    def clients(self) -> List[str]:
        return list(broadcast._subscribers.keys())


hub = Hub()


class ClientMessage(BaseModel):
    join_ref: str | None
    ref: str | None
    topic: str
    event: str
    payload: Any  # TODO jsonable, typed by framework

    @property
    def ok(self) -> dict:
        return {"status": "ok", "response": {}}

    @property
    def channel_name(self) -> str:
        """it's in format channel:<name>"""
        return self.topic.lstrip("channel:")

    @classmethod
    def from_string(cls, text) -> ClientMessage:
        [join_ref, ref, topic, event, payload] = json.loads(text)
        match event:
            case event if event in ["phx_join", "phx_leave"]:
                event = event.lstrip("phx_")
            case event:
                event = event
        return ClientMessage(join_ref=join_ref, ref=ref, topic=topic, event=event, payload=payload)

    def to_array(self) -> List[int | str | Any]:
        return [self.join_ref, self.ref, self.topic, self.event, self.payload]


def is_heartbeat(message: ClientMessage) -> bool:
    return message.topic == "phoenix" and message.event == "heartbeat"


def is_joining_message(message: ClientMessage) -> bool:
    return message.event in ["phx_join", "join"]


def is_leaving_message(message: ClientMessage) -> bool:
    return message.event == ["phx_leave", "leave"]


async def handle_heartbeat(client_id: str, message: ClientMessage) -> None:
    """always respond"""
    log.debug("[%s] - receive heartbeat from client", client_id)
    await broadcast.publish(channel=client_id, message=json.dumps([message.join_ref, message.ref, message.topic, "phx_reply", message.ok]))
    log.debug("[%s] - heartbeat piped: %s [%s]", client_id, type(message), message)


async def ok_to_join(client_id: str, message: ClientMessage, response=None):
    log.debug("DEFAULT JOIN HANDLER, %s is joining %s ...", client_id, message.topic)

    hub.add(client_id, message.topic)
    default_payload = {"status": "ok", "response": response or {}}
    # response_message = [message.join_ref, message.ref, message.topic, "phx_reply", default_payload]
    response_message = json.dumps([message.join_ref, message.ref, message.topic, "phx_reply", default_payload])
    log.error("%s %s", response_message, type(response_message))
    # log.error("%s\n%s\n", json.dumps(response_message), json.dumps(response_message[-1]))
    try:
        await broadcast.publish(channel=client_id, message=response_message)
    except redis.exceptions.DataError as exc:
        log.error("%s", exc)
    log.debug("[%s] - %s response piped: %s [%s]", client_id, message.event, type(message), message)


async def ok_to_leave(client_id: str, message: ClientMessage):
    log.debug("DEFAULT LEAVE HANDLER, %s is leaving %s ...", client_id, message.topic)

    await broadcast.publish(channel=client_id, message=json.dumps([message.join_ref, message.ref, message.topic, "phx_reply", message.ok]))
    hub.remove(client_id, message.topic)
    log.debug("[%s] - %s response piped %s", client_id, message.event, message.topic)


async def websocket_receiver(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] - receive task", client_id)
    async for text in websocket.iter_text():
        client_message: ClientMessage = ClientMessage.from_string(text)  # noqa
        log.debug("[%s] < %s [%s]", client_id, type(text), text)
        log.debug("client message: %s", client_message)

        if is_heartbeat(client_message):
            await handle_heartbeat(client_id, client_message)
            continue

        if is_joining_message(client_message):
            await ok_to_join(client_id, client_message)
            continue

        if is_leaving_message(client_message):
            await ok_to_leave(client_id, client_message)
            continue

        publish_topic = f"{client_message.topic}:{client_message.event}"
        redis_client.publish(publish_topic, text)
        # log.debug("> RX / to Redis %s %s", publish_topic, text)

    log.debug("[%s] done\n\n", client_id)


async def websocket_sender(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] > send task", client_id)
    async with broadcast.subscribe(client_id) as subscriber:
        log.info("[%s] > new subscriber created, %s", client_id, subscriber)
        async for event in subscriber:
            message = event.message
            # log.debug("to send %s %s", message, type(message))
            await websocket.send_text(message)
    log.info("[%s] sending task is done", client_id)


async def websocket_broadcast(websocket: WebSocket, client_id: str) -> None:
    """get messages from a redis broadcast channel and publish to client"""
    log.info("[%s] > broadcast task", client_id)
    async with broadcast.subscribe("broadcast") as subscriber:
        async for event in subscriber:
            # log.debug("to broadcast %s", event.message)
            await websocket.send_text(event.message)
    log.info("[%s] broadcast task is done", client_id)


async def handle_websocket_client(client_id: str, ws: WebSocket):
    # TODO interface deprecated
    await run_until_first_complete(
        (websocket_receiver, {"websocket": ws, "client_id": client_id}),
        (websocket_sender, {"websocket": ws, "client_id": client_id}),
        (websocket_broadcast, {"websocket": ws, "client_id": client_id}),
    )


async def publish_any(channel: str, event: str, any: Any) -> int:
    """this publishes to client"""
    message = [None, None, channel, event, any]
    clients = hub.channel_clients().get(channel, [])
    for client_id in clients:
        await broadcast.publish(channel=client_id, message=json.dumps(message))
    return len(clients)


async def system_broadcast(*, channel: str, event: str, data: Any, by_redis: bool = False) -> None:
    # if not channel.startswith("channel:"):
    #     log.warning("channel name should start with `channel:`, correcting %s => %s", channel, f"channel:{channel}")
    #     channel = f"channel:{channel}"

    message = [None, None, channel, event, data]
    # (redis_client if by_redis else broadcast).publish(channel, json.dumps(message))
    if by_redis:  # FIXME: not working properly
        await redis_client.publish(channel, json.dumps(message))
    else:
        # check the `websocket_broadcast` function, it's listening to `broadcast` channel
        await broadcast.publish(channel="broadcast", message=json.dumps(message))
    # log.debug("message broadcasted")
