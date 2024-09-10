from __future__ import annotations

import functools
import inspect
import json
import logging
import re
from typing import Any, List, Optional

import redis
from broadcaster import Broadcast
from fastapi import WebSocket
from pydantic import BaseModel
from starlette.concurrency import run_until_first_complete

from tangram.util.geojson import BetterJsonEncoder

log = logging.getLogger(__name__)

# broadcast = Broadcast("redis://127.0.0.1:6379")
broadcast = Broadcast("memory://")
redis_client = redis.from_url("redis://192.168.8.37:6379")  # TODO: confiburable
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
    return message.event == "phx_join"


def is_leaving_message(message: ClientMessage) -> bool:
    return message.event == "phx_leave"


async def handle_heartbeat(client_id: str, message: ClientMessage) -> None:
    """always respond"""
    log.debug("[%s] - receive heartbeat from client", client_id)
    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", message.ok],
    )
    # log.debug("[%s] - heartbeat piped: %s [%s]", client_id, type(message), message)


async def ok_to_join(client_id: str, message: ClientMessage, response=None):
    log.debug("DEFAULT JOIN HANDLER, %s is joining %s ...", client_id, message.topic)

    hub.add(client_id, message.topic)
    default_payload = {"status": "ok", "response": response or {}}
    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", default_payload],
    )
    # log.info("[%s] - %s response piped: %s [%s]", client_id, message.event, type(message), message)


async def ok_to_leave(client_id: str, message: ClientMessage):
    log.debug("DEFAULT LEAVE HANDLER, %s is leaving %s ...", client_id, message.topic)

    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", message.ok],
    )
    hub.remove(client_id, message.topic)
    # log.info("[%s] - %s response piped %s", client_id, message.event, message.topic)


class ChannelHandlerMixin:
    def __init__(self, channel_name: str) -> None:
        self._channel_name = channel_name
        self.event_handlers = []

    @property
    def channel_name(self):
        return self._channel_name

    def will_handle_channel(self, channel_name: str) -> bool:
        """accept when channel matches exactly"""
        return channel_name.lower() == self.channel_name

    async def dispatch_events(self, client_id: str, message: ClientMessage) -> bool:
        channel, event = message.topic, message.event
        log.debug("%s(in %s), from %s, disptaching event %s %s ...", self, self.channel_name, client_id, channel, event)

        log.debug("event_handlers: %s", self.event_handlers)
        for i, event_handler in enumerate(self.event_handlers):
            channel_pattern_regexp, event_pattern_regexp, fn = event_handler[:3]
            args, kwargs = event_handler[3:] if len(event_handler) == 5 else ([], {})

            log.debug("%s matching, %s, %s, %s %s", i, channel_pattern_regexp, event_pattern_regexp, args, kwargs)
            if bool(channel_pattern_regexp.match(channel)) and bool(event_pattern_regexp.match(event)):
                log.debug("matched, calling %s...", fn)
                if inspect.isfunction(fn):
                    result = await fn(client_id, message)
                    log.debug("function: %s %s => %s", fn, fn.__name__, result)
                if inspect.ismethod(fn):
                    result = await getattr(kwargs["obj"], fn.__name__)(client_id, message)
                    log.debug("method: %s %s %s => %s", fn, fn.__name__, getattr(kwargs["obj"], fn.__name__), result)
        if event == "join":
            await ok_to_join(client_id, message)
        if event == "leave":
            await ok_to_leave(client_id, message)
        return False

    def register_channel_event_handler(
        self, fn, channel_pattern: Optional[str] = None, event_pattern: Optional[str] = None, *args, **kwargs
    ):
        if channel_pattern is None:
            channel_pattern = self.channel_name
        channel_pattern_regexp = re.compile(channel_pattern)
        if event_pattern is None:
            event_pattern = fn.__name__  # name as the parameter, or use the function name
        event_pattern_regexp = re.compile(event_pattern)  # FIXME: ?
        self.event_handlers.append((channel_pattern_regexp, event_pattern_regexp, fn, args, kwargs))
        print(self.event_handlers)

    def on_channel_event(self, channel_pattern: Optional[str] = None, event_pattern: Optional[str] = None):
        if channel_pattern is None:
            channel_pattern = self.channel_name
        channel_pattern_regexpr = re.compile(channel_pattern)
        event_pattern_regexpr = re.compile(event_pattern) if event_pattern else None

        def decorator(fn):
            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                log.info("fn: %s args: %s, kargs: %s", fn, args, kwargs)
                return fn

            nonlocal channel_pattern_regexpr
            nonlocal event_pattern_regexpr
            if event_pattern_regexpr is None:
                event_pattern_regexpr = re.compile(fn.__name__)

            self.event_handlers.append((channel_pattern_regexpr, event_pattern_regexpr, fn))
            return wrapper

        return decorator


channel_handlers = {}


def register_channel_handler(handler):
    """plugins call the function to register their event handlers"""
    channel_handlers[handler.channel_name] = handler


def _get_channel_handler(channel_name: str):
    for _channel_name, handler in channel_handlers.items():
        if handler.will_handle_channel(channel_name):
            return handler
    return None


def on_channel_event(_func, *, channel_pattern, event_pattern):
    """both patterns are regex"""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            log.info("fn: %s, args: %s, kargs: %s", fn, args, kwargs)
            # event_handlers[event_name] = fn
            return fn

        return wrapper

    # @on_channel_event => _func is None
    # @on_channel_event(..) => _func is a function
    return decorator if _func is None else decorator(_func)


async def websocket_receiver(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] - receive task", client_id)
    async for text in websocket.iter_text():
        log.debug("[%s] < %s [%s]", client_id, type(text), text)

        client_message: ClientMessage = ClientMessage.from_string(text)  # noqa

        if is_heartbeat(client_message):
            await handle_heartbeat(client_id, client_message)
            continue

        publish_topic = f"{client_message.topic}:{client_message.event}"
        redis_client.publish(publish_topic, text)
        log.info(">>>>> %s %s", publish_topic, client_message.payload)

        for _channel_name, handler in channel_handlers.items():
            await handler.dispatch_events(client_id, client_message)  # handler dispatch based on event

    # TODO: cleanup
    log.debug("[%s] done\n\n", client_id)


async def websocket_sender(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] > send task", client_id)
    async with broadcast.subscribe(client_id) as subscriber:
        log.info("[%s] > new subscriber created, %s", client_id, subscriber)
        async for event in subscriber:
            message = event.message
            await websocket.send_text(json.dumps(message, cls=BetterJsonEncoder))
    log.info("[%s] sending task is done", client_id)


async def handle_websocket_client(client_id: str, ws: WebSocket):
    # TODO interface deprecated
    await run_until_first_complete(
        (websocket_receiver, {"websocket": ws, "client_id": client_id}),
        (websocket_sender, {"websocket": ws, "client_id": client_id}),
    )


async def publish_any(channel: str, event: str, any: Any) -> int:
    message = [None, None, channel, event, any]
    clients = hub.channel_clients().get(channel, [])
    for client_id in clients:
        await broadcast.publish(channel=client_id, message=message)
        # log.debug("message published to %s", client_id)
    return len(clients)
