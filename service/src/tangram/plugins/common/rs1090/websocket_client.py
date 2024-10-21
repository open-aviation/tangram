#!/usr/bin/env python
#

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from typing import Callable, Set, List, Tuple

import websockets

log: logging.Logger = logging.getLogger(__name__)


class ClientChannel:
    def __init__(self, connection: ClientConnection, channel_name: str, join_ref: str, loop=None) -> None:
        self.connection = connection
        self.channel_name: str = channel_name
        self.loop = loop or asyncio.get_event_loop()
        self._event_handlers: dict[str, Set[Callable]] = {}
        self.join_ref: str = join_ref
        self.ref: int = 0

    def __repr__(self) -> str:
        return f"""<Channel name="{self.channel_name}" join_ref={self.join_ref}>"""

    async def join_async(self) -> ClientChannel:
        result = await self.send_async("phx_join", {})
        log.debug("join message sent: %s", self.channel_name)
        return result

    async def on_join(self, join_ref, ref, channel, event, status, response) -> None:
        """default joining handler"""
        log.info("ignore joining reply: %s %s %s %s %s", channel, join_ref, ref, status, response)

    async def run_event_handler(self, event: str, *args, **kwargs) -> None:
        """this is called from the connection when a message is received"""
        if event == "phx_reply":
            for fn in self._event_handlers.get("join", []):
                result = fn(*args, **kwargs)
                if asyncio.iscoroutine(result):
                    await result
            # else:
            #     await self.on_join(*args, **kwargs)
            return

        for fn in self._event_handlers.get(event, []):
            result = fn(*args, **kwargs)
            if asyncio.iscoroutine(result):
                await result

    async def send_async(self, event: str, payload: dict) -> ClientChannel:
        message = json.dumps([self.join_ref, str(self.ref), self.channel_name, event, payload])
        await self.connection.send(message)
        # if event == "phx_join":
        #     self.join_ref += 1
        self.ref += 1
        return self

    def on_event(self, event: str, fn: Callable) -> ClientChannel:
        if event not in self._event_handlers:
            self._event_handlers[event] = set()
        self._event_handlers[event].add(fn)
        return self

    def off_event(self, event: str, fn: Callable) -> ClientChannel:
        self._event_handlers[event].remove(fn)
        return self

    def on(self, event: str) -> Callable:
        def decorator(fn):
            self.on_event(event, fn)
            return fn

        return decorator

    def off(self, event: str) -> Callable:
        def decorator(fn):
            self.off_event(event, fn)

        return decorator


class Singleton(type):
    _instances = {}

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            log.info("creating new instance of %s", cls.__name__)
            cls._instances[cls] = super(Singleton, cls).__call__(*args, **kwargs)
        # else:
        #     log.info('init with existing instance of %s', cls.__name__)
        #     cls._instances[cls].__init__(*args, **kwargs)
        return cls._instances[cls]


class ClientConnection(metaclass=Singleton):
    def __new__(cls):
        if not hasattr(cls, "instance"):
            cls.instance = super().__new__(cls)
        return cls.instance

    def __init__(self, loop=None):
        self.websocket_url: str
        self._CHANNEL_CALLBACKS = {}  # f'{channel}-{event}' -> callback
        self.channels: List[Tuple[str, ClientChannel]] = []
        self.loop = None  # loop or asyncio.get_running_loop()
        self.connected: bool = False

    def add_channel(self, channel_name: str, handlers: dict[str, Callable] | None = None) -> ClientChannel:
        join_ref = str(len(self.channels) + 1)
        channel: ClientChannel = ClientChannel(self, channel_name, join_ref, self.loop)
        self.channels.append((join_ref, channel))
        log.info("added a new channel %s %s", channel_name, channel)
        if handlers:
            for event, fn in handlers.items():
                channel.on_event(event, fn)
                log.debug('added event handler "%s" for %s', event, channel_name)
        return channel

    async def connect_async(self, websocket_url: str):
        """asyncio context entrypoint
        this is started in a global startup hook."""
        self.websocket_url = websocket_url
        # ping/pong keepalive disabled
        # https://websockets.readthedocs.io/en/stable/topics/timeouts.html
        self._connection = await websockets.connect(self.websocket_url, ping_interval=None)
        self.connected = True

        log.info("connected to %s (%s)", self.websocket_url, self.connected)

    async def send(self, message: str):
        await self._connection.send(message)

    async def start_async(self) -> None:
        log.info("starting jet1090 websocket client ...")
        await asyncio.gather(self._heartbeat(), self._dispatch())

    async def _heartbeat(self):
        """keepalive to the jet1090 server"""
        ref = 0
        while True:
            await self._connection.send(json.dumps(["0", str(ref), "phoenix", "heartbeat", {}]))
            log.debug("jet1090 keepalive message sent")

            await asyncio.sleep(60)
            ref += 1

    async def _dispatch(self):
        """dispatch messages to registered callbacks"""
        try:
            async for message in self._connection:
                [join_ref, ref, channel_name, event, payload] = json.loads(message)
                # log.debug("message: %s", message)
                status, response = payload["status"], payload["response"]

                # joined to the same channel and now getting the same data; just duplicate data with adapted join_ref
                for channel_join_ref, channel in self.channels:
                    if channel.channel_name == channel_name:
                        await channel.run_event_handler(event, channel_join_ref, ref, channel, event, status, response)
        except websockets.exceptions.WebSocketException:
            # FIXME: reconnect
            log.exception(f"lost connection to {self.websocket_url}")
        except Exception:
            log.exception("unknown exception")


jet1090_websocket_client: ClientConnection = ClientConnection()
