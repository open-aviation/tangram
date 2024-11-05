import asyncio
import logging
from datetime import UTC, datetime

import pandas as pd
from fastapi import APIRouter

from tangram import websocket as channels
from tangram.plugins.history.storage import HistoryDB

log = logging.getLogger(__name__)

history_db = HistoryDB(read_only=True)


DT_FMT = "%H:%M"


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
        "html": f"""<span id="{el}">{pd.Timedelta(counter, unit="s")}</span>""",
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


async def startup():
    asyncio.create_task(server_events())
    log.info("system plugin is started")


async def shutdown():
    log.info("system plugin ends")


app = APIRouter(on_startup=[startup], on_shutdown=[])
