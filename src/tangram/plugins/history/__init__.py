#!/usr/bin/env python
# coding: utf8

import asyncio
import logging

from fastapi import APIRouter
from tangram.plugins.common.rs1090 import Jet1090Data
from tangram.plugins.common.rs1090.websocket_client import Channel, jet1090_websocket_client

from .storage import HistoryDB

log = logging.getLogger("tangram")


async def start():
    history_db = HistoryDB(use_memory=False)
    await history_db.load_all_history()
    asyncio.create_task(history_db.expire_records_periodically())

    asyncio.create_task(history_db.load_by_restful_client())
    log.info("history joins jet1090 channel")


async def start_with_ws():
    # FIXME: two plugins subscribing to the same channel, not join_ref in response
    history_db = HistoryDB(use_memory=False)
    await history_db.load_all_history()
    asyncio.create_task(history_db.expire_records_periodically())

    async def on_jet1090_data(join_ref, ref, channel, event, status, response):
        timed_message = response.get("timed_message")
        # log.debug("got data %s", timed_message)

        item = Jet1090Data(**timed_message)
        # log.debug("item: %s", item)

        if item.icao24 and item.last:
            if item.latitude is None and item.longitude is None:
                pass
            else:
                log.debug("%s, first     : %s", join_ref, item)
                if item.latitude and item.longitude:
                    history_db.insert_many_tracks([item])
                    log.debug("%s, trajectory: %s", join_ref, item)
                    log.debug("----")

                if item.altitude:
                    history_db.insert_many_altitudes([item])
                    # log.debug("altitude: %s", item)

    data_source_channel: Channel = jet1090_websocket_client.add_channel("jet1090")
    data_source_channel.on_event("data", on_jet1090_data)
    asyncio.create_task(data_source_channel.join_async())

    log.info("history joins jet1090 channel")


app = APIRouter(prefix="/history", on_startup=[start])
