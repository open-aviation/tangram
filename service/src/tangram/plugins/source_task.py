from __future__ import annotations

import asyncio
import logging

import dotenv

from tangram import websocket as channels
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client
from tangram.websocket import ChannelHandlerMixin, ClientMessage, register_channel_handler

dotenv.load_dotenv()
log = logging.getLogger(__name__)


class Rs1090SourceChannelHandler(ChannelHandlerMixin):
    pass


rs1090_source_channel_handler = Rs1090SourceChannelHandler("channel:streaming")
register_channel_handler(rs1090_source_channel_handler)


@rs1090_source_channel_handler.on_channel_event(event_pattern="event:select")
async def handle_select(client_id: str, message: ClientMessage):
    log.info("%s selects icao24: %s", client_id, message.payload)


async def on_jet1090_data(join_ref, ref, channel, event, status, response):
    """handle data from jet1090 data channel: get message then publish to to tangram channels"""
    timed_message = response.get("timed_message")
    log.info("SOURCE / RT data %s", timed_message)

    icao24 = timed_message.get("icao24")
    if icao24:
        await channels.publish_any("channel:streaming", "new-data", timed_message)


data_task = None


async def start() -> None:
    global data_task

    # use jet1090 websocket
    jet1090_data_channel = jet1090_websocket_client.add_channel("jet1090")
    jet1090_data_channel.on_event("data", on_jet1090_data)
    data_task = asyncio.create_task(jet1090_data_channel.join_async())  # TODO: join this on leaving


async def shutdown() -> None:
    if data_task:
        data_task.cancel()
    log.info("shutdown - done%s", "\n" * 4)


async def main():
    try:
        await start()
    except asyncio.CancelledError:
        log.warning("source_task is cancelled, cleanup ...")
        await shutdown()
