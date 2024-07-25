import asyncio
import logging
import json

from fastapi import APIRouter
from tangram import websocket as channels
from tangram.plugins.common.rs1090.websocket_client import Channel, jet1090_websocket_client
from tangram.websocket import ChannelHandlerMixin, ClientMessage, register_channel_handler

# from redis import Redis
# redis_client = Redis.from_url("redis://localhost:6379/0")

log = logging.getLogger("tangram")

selected_icao24 = None


async def on_data(join_ref, ref, channel, event, status, response):
    global selected_icao24

    timed_message = response.get("timed_message")
    icao24 = timed_message.get("icao24")
    log.debug("CHART, ch: %s, icao24: %s, selected: %s", channel, icao24, selected_icao24)
    if icao24 and icao24 == selected_icao24:
        # _subscriber_count = redis_client.publish(f"chart:{icao24}", json.dumps(response))
        # log.info("CHART, `%s`, ref: %s, status: %s, redis subscribers: %s", channel, ref, status, _subscriber_count)

        await channels.publish_any(f"channel:chart:{icao24}", "chart-update", response)
        log.info("CHART, `%s`, ref: %s, status: %s", channel, ref, status)


jet1090_client_channel: Channel = jet1090_websocket_client.add_channel("jet1090")
jet1090_client_channel.on_event("data", on_data)

##


class ChannelHandler(ChannelHandlerMixin):
    """Use all default method.
    A instance object is inititialized in the App"""


channel_handler = ChannelHandler("chart")
register_channel_handler(channel_handler)


async def join_channel(client_id: str, message: ClientMessage):
    log.info("CHART, %s join: %s", client_id, message.topic)


async def handle_selecting_icao24(client_id: str, message: ClientMessage):
    global selected_icao24
    selected_icao24 = message.payload["icao24"]
    # redis_client.publish("chart:meta:selected_icao24", selected_icao24)

    log.info("CHART, %s select a new plane %s", client_id, selected_icao24)


channel_handler.register_channel_event_handler(join_channel, "channel:chart:*", "join")
channel_handler.register_channel_event_handler(handle_selecting_icao24, "channel:streaming", "event:select")


async def start():
    asyncio.create_task(jet1090_client_channel.join_async())
    log.info("subscribe to jet1090 data streaming")

    # asyncio.create_task()


app = APIRouter(on_startup=[start], on_shutdown=[])
