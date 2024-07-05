import logging
import asyncio
from datetime import datetime, UTC

from fastapi import APIRouter
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client
from tangram import websocket as channels

log = logging.getLogger("tangram")


#### channel handler
class SystemChannelHandler(channels.ChannelHandlerMixin):
    pass


channel_handler = SystemChannelHandler("channel:system")
channels.register_channel_handler(channel_handler)


####
DT_FMT = "%H:%M:%S"


def uptime_html(counter):
    return {"el": "uptime", "html": f"""<span id="uptime">{counter}</span>"""}


def info_utc_html(dtfmt=DT_FMT):
    return {
        "el": "info_utc",
        "html": f"""<span id="info_utc">{datetime.now(UTC).strftime(dtfmt)}</span>""",
    }


def info_local_html(dtfmt=DT_FMT):
    return {
        "el": "info_local",
        "html": f"""<span id="info_local">{datetime.now().strftime(dtfmt)}</span>""",
    }


async def server_events():
    counter = 0
    while True:
        await channels.publish_any("channel:system", "uptime", uptime_html(counter))
        await channels.publish_any("channel:system", "info_utc", info_utc_html())
        await channels.publish_any("channel:system", "info_local", info_local_html())
        log.info("system channel events sent")

        counter += 1
        await asyncio.sleep(1)


#### client to rs1090 channel
def on_system_joining(join_ref, ref, channel, event, status, response):
    log.info("system, joined: %s", response)


def on_system_datetime(join_ref, ref, channel, event, status, response):
    log.debug("system, datetime: %s", response)


system_channel = jet1090_websocket_client.add_channel("system")
system_channel.on_event("join", on_system_joining)
system_channel.on_event("datetime", on_system_datetime)


async def start():
    asyncio.create_task(system_channel.join_async())
    asyncio.create_task(server_events())
    log.info("system plugin started")


app = APIRouter(on_startup=[start], on_shutdown=[])
