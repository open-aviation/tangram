import json
import logging
from typing import Any, List

from broadcaster import Broadcast
from fastapi import WebSocket
from pydantic import BaseModel

from tangram.plugins import rs1090_source

log = logging.getLogger(__name__)

# broadcast = Broadcast("redis://127.0.0.1:6379")
broadcast = Broadcast("memory://")


class Hub:
    def __init__(self) -> None:
        self._channel_clients: dict[str, set[str]] = {}  # channel -> {clients}

    def join(self, client_id: str, channel: str) -> None:
        if channel not in self._channel_clients:
            self._channel_clients[channel] = set()
        self._channel_clients[channel].add(client_id)

    def channel_clients(self) -> dict[str, set[str]]:
        return self._channel_clients

    def channels(self) -> List[str]:
        return list(self.channel_clients().keys())

    def clients(self) -> List[str]:
        return list(broadcast._subscribers.keys())


hub = Hub()


class Message(BaseModel):
    join_ref: int | None
    ref: int | None
    topic: str
    event: str
    payload: Any  # TODO jsonable, typed by framework

    @classmethod
    def from_string(cls, text) -> 'Message':
        [join_ref, ref, topic, event, payload] = json.loads(text)
        return Message(join_ref=join_ref, ref=ref, topic=topic, event=event, payload=payload)

    def to_array(self) -> List[int | str | Any]:
        return [self.join_ref, self.ref, self.topic, self.event, self.payload]


def is_heartbeat(message: Message) -> bool:
    return message.topic == 'phoenix' and message.event == 'heartbeat'


def is_joining(message: Message) -> bool:
    return message.event == 'phx_join'


def is_leaving(message) -> bool:
    return message.event == 'phx_leave'


class ClientMessage(Message):
    pass


class ServerMessage(Message):
    pass


async def handle_heartbeat(client_id: str, client_message: ClientMessage) -> None:
    """always respond"""
    log.debug("[%s] - receive heartbeat from client", client_id)

    message: list[Any] = [
        client_message.join_ref,
        client_message.ref,
        client_message.topic,
        "phx_reply",  # event
        {"status": "ok", "response": {}},  # payload
    ]
    await broadcast.publish(channel=client_id, message=message)
    log.debug("[%s] - heartbeat piped: %s [%s]", client_id, type(message), message)


async def handle_joining(client_id: str, client_message: ClientMessage):
    log.info("[%s] - want to join %s", client_id, client_message.topic)
    hub.join(client_id, client_message.topic)
    message = [
        client_message.join_ref,
        client_message.ref,
        client_message.topic,
        "phx_reply",
        {"status": "ok", "response": {"client_id": client_id}},
    ]
    await broadcast.publish(client_id, message)
    log.debug("[%s] - %s response piped: %s [%s]", client_id, client_message.event, type(message), message)


async def handle_leaving(client_id: str, client_message: ClientMessage):
    message = [
        client_message.join_ref,
        client_message.ref,
        client_message.topic,
        "phx_reply",
        {"status": "ok", "response": {}},
    ]
    await broadcast.publish(channel=client_id, message=message)
    log.info("[%s] - %s response piped %s", client_id, client_message.event, client_message.topic)


class BroadcastMessageHandler:
    @classmethod
    def will_handle(cls, message: Message) -> bool:
        # TODO allowing all for now
        return message.topic in ["channel:system", "channel:streaming"] and message.event in ["new-traffic", "new-turb"]

    @classmethod
    async def process(cls, client_id: str, client_message: Message) -> bool:
        log.debug("[%s] - system broadcast", client_id)

        # response
        message = [None, client_message.ref, client_message.topic, "phx_reply", {"status": "ok", "response": {}}]
        await broadcast.publish(channel=client_id, message=message)

        # broadcast
        for subscriber in hub.clients():
            if subscriber == client_id:
                continue
            message = [None, None, client_message.topic, client_message.event, client_message.payload]
            await broadcast.publish(channel=subscriber, message=message)
        return True


class Rs1090MessageHandler:

    @classmethod
    def will_handle(cls, message: Message) -> bool:
        return message.topic == "channel:streaming" and message.event.startswith("plugin:")

    @classmethod
    async def process(cls, client_id: str, message: ClientMessage) -> bool:
        """TODO: return None if the chain continues, will ServerResponse if this terminates the chain"""
        _, plugin_name, plugin_event = message.event.split(":")
        log.info("plugin: %s, event: %s", plugin_name, plugin_event)

        # let's assume `rs1090_plugin` for now
        if plugin_event in rs1090_source.event_handlers:
            rs1090_source.event_handlers[plugin_event](message.payload)
            log.info("called plugin event handler")
            return True
        else:
            log.info("event handler not found")
            return False


CLIENT_MESSAGE_HANDLERS = [
    Rs1090MessageHandler(),
    BroadcastMessageHandler(),
]


async def websocket_receiver(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] - receive task", client_id)
    async for text in websocket.iter_text():
        log.debug("[%s] < %s [%s]", client_id, type(text), text)

        client_message: ClientMessage = ClientMessage.from_string(text)

        # TODO make these three if-then handling into handlers
        if is_heartbeat(client_message):
            await handle_heartbeat(client_id, client_message)
            continue

        if is_joining(client_message):
            await handle_joining(client_id, client_message)
            continue

        if is_leaving(client_message):
            await handle_leaving(client_id, client_message)
            continue

        for handler in CLIENT_MESSAGE_HANDLERS:
            if handler.will_handle(client_message):
                if handler.process(client_id, client_message):
                    log.debug('handler %s handles it', handler.__class__)
                    break
    # TODO cleanup
    log.debug("[%s] done")


async def websocket_sender(websocket: WebSocket, client_id: str) -> None:
    log.info("[%s] > send task", client_id)
    async with broadcast.subscribe(client_id) as subscriber:
        log.info("[%s] > new subscriber created, %s", client_id, subscriber)
        async for event in subscriber:
            # log.info('ev: %s', event)
            message = event.message
            await websocket.send_text(json.dumps(message))
            # log.debug('[%s] > message sent: %s', client_id, message)
    log.info("[%s] sending task is done", client_id)


class Greeting(BaseModel):
    """Message for Channel publishing"""
    channel: str
    event: str = "new-data"
    message: str | None = None


async def publish(greeting: Greeting):
    log.info("channel: %s", greeting.channel)
    if greeting.message is None:
        return
    message = [
        None,
        None,
        greeting.channel,
        greeting.event,
        json.loads(greeting.message),
    ]
    for client_id in hub.channel_clients().get(greeting.channel, []):
        await broadcast.publish(channel=client_id, message=message)
        log.info("publish to %s", client_id)