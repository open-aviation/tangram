import logging
import asyncio
from datetime import datetime, UTC

from fastapi import APIRouter
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client
from tangram import websocket as channels
from tangram.plugins.history.storage import HistoryDB

log = logging.getLogger("tangram")


class TangramApplication(APIRouter):
    pass


class System(TangramApplication):
    pass


#### channel handler
class SystemChannelHandler(channels.ChannelHandlerMixin):
    pass


channel_handler = SystemChannelHandler("channel:system")
channels.register_channel_handler(channel_handler)


####
history_db = HistoryDB(read_only=True)


DT_FMT = "%H:%M:%S"


def aircraft_on_map():
    total = history_db.count_tracks()
    el = "plane_count"
    return {
        "el": el,
        "html": f"""<p style="display: inline" id="{el}">{total}</p>""",
    }


def uptime_html(counter):
    el = "uptime"
    return {
        "el": el,
        "html": f"""<span id="{el}">{counter}</span>""",
    }


def info_utc_html(dtfmt=DT_FMT):
    el = "info_utc"
    return {
        "el": el,
        "html": f"""<span id="{el}">{datetime.now(UTC).strftime(dtfmt)}</span>""",
    }


def info_local_html(dtfmt=DT_FMT):
    el = "info_local"
    return {
        "el": el,
        "html": f"""<span id="{el}">{datetime.now().strftime(dtfmt)}</span>""",
    }


async def server_events():
    counter = 0

    while True:
        await channels.publish_any("channel:system", "update-node", uptime_html(counter))
        await channels.publish_any("channel:system", "update-node", info_utc_html())
        await channels.publish_any("channel:system", "update-node", info_local_html())
        await channels.publish_any("channel:system", "update-node", aircraft_on_map())

        counter += 1
        await asyncio.sleep(1)


#### client to jet1090 channel
def on_system_joining(join_ref, ref, channel, event, status, response):
    log.info("SYSTEM, `%s`, join, %s %s %s %s", channel, join_ref, ref, status, response)


def on_system_datetime(join_ref, ref, channel, event, status, response):
    log.debug("SYSTEM, `%s`, datetime, %s %s %s %s", channel, join_ref, ref, status, response)


system_channel = jet1090_websocket_client.add_channel("system")
system_channel.on_event("join", on_system_joining)
system_channel.on_event("datetime", on_system_datetime)


async def start():
    asyncio.create_task(system_channel.join_async())
    asyncio.create_task(server_events())
    log.info("system plugin started")


app = APIRouter(on_startup=[start], on_shutdown=[])
