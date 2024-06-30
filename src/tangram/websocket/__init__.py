from __future__ import annotations

import json
import logging
from typing import Any, List

from broadcaster import Broadcast
from fastapi import WebSocket
from pydantic import BaseModel
from starlette.concurrency import run_until_first_complete

from tangram.plugins import rs1090_source
from tangram.util.geojson import BetterJsonEncoder

log = logging.getLogger(__name__)

# broadcast = Broadcast("redis://127.0.0.1:6379")
broadcast = Broadcast("memory://")


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
        return ClientMessage(join_ref=join_ref, ref=ref, topic=topic, event=event, payload=payload)

    def to_array(self) -> List[int | str | Any]:
        return [self.join_ref, self.ref, self.topic, self.event, self.payload]


def is_heartbeat(message: ClientMessage) -> bool:
    return message.topic == "phoenix" and message.event == "heartbeat"


def is_joining(message: ClientMessage) -> bool:
    return message.event == "phx_join"


def is_leaving(message: ClientMessage) -> bool:
    return message.event == "phx_leave"


async def handle_heartbeat(client_id: str, message: ClientMessage) -> None:
    """always respond"""
    log.debug("[%s] - receive heartbeat from client", client_id)
    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", message.ok],
    )
    log.debug("[%s] - heartbeat piped: %s [%s]", client_id, type(message), message)


async def ok_to_join(client_id: str, message: ClientMessage):
    log.info("[%s] - want to join %s", client_id, message.topic)
    hub.add(client_id, message.topic)
    default_payload = {"status": "ok", "response": {"client_id": client_id}}
    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", default_payload],
    )
    log.info("[%s] - %s response piped: %s [%s]", client_id, message.event, type(message), message)


async def ok_to_leave(client_id: str, message: ClientMessage):
    log.info("[%s] - is to leave %s", client_id, message.topic)
    await broadcast.publish(
        channel=client_id,
        message=[message.join_ref, message.ref, message.topic, "phx_reply", message.ok],
    )
    hub.remove(client_id, message.topic)
    log.info("[%s] - %s response piped %s", client_id, message.event, message.topic)


class SystemChannelHandler:
    name = "system"

    def __init__(self) -> None:
        pass

    def will_handle_channel(self, channel_name) -> bool:
        return channel_name == "system"

    def handle_joining(self, client_id: str, message: ClientMessage):
        return ok_to_join(client_id, message)

    def handle_leaving(self, client_id: str, message: ClientMessage):
        return ok_to_leave(client_id, message)

    async def handle_event(self, client_id: str, client_message: ClientMessage) -> bool:
        log.debug("[%s] - system broadcast", client_id)

        # response
        message = [None, client_message.ref, client_message.topic, "phx_reply", client_message.ok]
        await broadcast.publish(channel=client_id, message=message)

        # broadcast to all clients
        for subscriber in hub.clients():
            if subscriber == client_id:
                continue
            message = [None, None, client_message.topic, client_message.event, client_message.payload]
            await broadcast.publish(channel=subscriber, message=message)
        return True


class Rs1090SourceChannelHandler:
    name = "streaming"

    def will_handle_channel(self, channel_name: str) -> bool:
        return channel_name.lower() == self.name

    async def handle_joining(self, client_id: str, message: ClientMessage):
        return await ok_to_join(client_id, message)

    async def handle_leaving(self, client_id: str, message: ClientMessage):
        return await ok_to_leave(client_id, message)

    async def handle_event(self, client_id: str, message: ClientMessage) -> bool:
        _, plugin_name, plugin_event = message.event.split(":")
        log.info("plugin: %s, event: %s", plugin_name, plugin_event)

        if plugin_event in rs1090_source.event_handlers:
            rs1090_source.event_handlers[plugin_event](message.payload)
            log.info("called plugin event handler")
            return True
        else:
            log.info("event handler not found")
            return False


class TrajectoryChannelHandler:
    def __init__(self) -> None:
        pass

    @property
    def channel_name(self) -> str:
        return "channel:trajectory"

    def will_handle_channel(self, channel_name: str) -> bool:
        return channel_name.lower().startswith(f"{self.channel_name}:")

    async def handle_joining(self, client_id: str, message: ClientMessage):
        return await ok_to_join(client_id, message)

    async def handle_leaving(self, client_id: str, message: ClientMessage):
        return await ok_to_leave(client_id, message)

    async def handle_event(self, client_id: str, message: ClientMessage) -> bool:
        return True


system_channel_handler = SystemChannelHandler()
rs1090_source_handler = Rs1090SourceChannelHandler()
trajectory_channel_handler = TrajectoryChannelHandler()

joining_handlers = {
    system_channel_handler.name: system_channel_handler,
    rs1090_source_handler.name: rs1090_source_handler,
    trajectory_channel_handler.channel_name: trajectory_channel_handler,
}

channel_event_handlers = {
    system_channel_handler.name: system_channel_handler,
    rs1090_source_handler.name: rs1090_source_handler,
    trajectory_channel_handler.channel_name: trajectory_channel_handler,
}

leaving_handlers = {
    system_channel_handler.name: system_channel_handler,
    rs1090_source_handler.name: rs1090_source_handler,
    trajectory_channel_handler.channel_name: trajectory_channel_handler,
}


async def websocket_receiver(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] - receive task", client_id)
    async for text in websocket.iter_text():
        log.debug("[%s] < %s [%s]", client_id, type(text), text)

        client_message: ClientMessage = ClientMessage.from_string(text)  # noqa

        if is_heartbeat(client_message):
            await handle_heartbeat(client_id, client_message)
            continue

        if is_joining(client_message):
            for channel_name, handler in joining_handlers.items():
                log.info("joining handler, %s => %s", channel_name, handler)
                if handler.will_handle_channel(client_message.topic):
                    result = await handler(client_id, client_message)
                    log.info("joining handler, %s => %s", channel_name, result)
                    break
            continue

        if is_leaving(client_message):
            for channel_name, handler in leaving_handlers.items():
                if handler.will_handle_channel(client_message.topic):
                    await handler(client_id, client_message)
                    break
            continue

        for channel_name, handler in channel_event_handlers.items():
            if handler.will_handle_channel(client_message.topic):
                await handler(client_id, client_message)
                break

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
