import asyncio
import logging
import pathlib
import sqlite3
from datetime import datetime
from time import time
from typing import Any, List, Optional
import pandas as pd

from fastapi import FastAPI

from tangram import websocket as channels
from tangram.plugins.common import rs1090
from tangram.plugins.common.rs1090.websocket_client import Channel, jet1090_websocket_client
from tangram.websocket import ChannelHandlerMixin, ClientMessage, register_channel_handler


log = logging.getLogger(__name__)
rs1090_client = rs1090.Rs1090Client()
MEMORY_FILE = ":memory:"

pd.set_option("display.max_columns", 100)


class Singleton:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not isinstance(cls._instance, cls):
            cls._instance = object.__new__(cls, *args, **kwargs)
        return cls._instance


class TrajectoryDB:
    def __init__(
        self,
        db_file: str | pathlib.Path = "trajectories.sqlite3",
        directory: pathlib.Path | None = None,
        delete_db: bool = False,
        drop_table: bool = False,
    ):
        # initialize database file and create database table. By default, in current directory
        match directory:
            case None:
                directory = pathlib.Path.cwd()
            case directory if isinstance(directory, str):
                directory = pathlib.Path(directory)
            case directory if not isinstance(directory, pathlib.Path):
                log.error("directory %s must be str or pathlib.Path")

        if isinstance(db_file, str) and db_file != MEMORY_FILE:
            db_file = directory / db_file

        if db_file != MEMORY_FILE and delete_db:
            db_file.unlink(missing_ok=True)
            log.warning("db file %s unlinked from system", db_file)

        self.conn = sqlite3.connect(db_file)
        if drop_table:
            self.conn.execute("DROP TABLE trajectories IF EXISTS;")
            log.warning("existing table trajectories removed from db")

        sql = """
          CREATE TABLE IF NOT EXISTS trajectories (
            id integer primary key autoincrement,
            icao24 text,
            last real,
            latitude real,
            longitude real,
            altitude real default null,
            UNIQUE (icao24, last)
          )
        """
        self.conn.execute(sql)

    def expire_records(self, expiration_seconds: int = 60 * 60 * 2):
        sql = """
            DELETE FROM trajectories
            WHERE UNIXEPOCH(current_timestamp) - last > :expiration_seconds
            -- RETURNING *
        """
        result: sqlite3.Cursor = self.conn.execute(sql, {"expiration_seconds": expiration_seconds})
        log.info("expire records older than %s seconds, %s records deleted", expiration_seconds, result.rowcount)

    def insert_many_with_ts_confict(self, items: List[dict[str, Any]]) -> None:
        # if items:
        #     log.debug("%s", items[0])

        sql = """
            INSERT INTO trajectories (icao24, last, latitude, longitude, altitude)
            VALUES (:icao24, :last, :latitude, :longitude, :altitude)
            ON CONFLICT(icao24, last) DO NOTHING
        """
        try:
            self.conn.executemany(sql, items)
            self.conn.commit()
        except:  # noqa
            log.exception("fail to write db")

    def list_tracks(self, icao24: str):
        sql = """
            SELECT id, icao24, last as timestamp, latitude, longitude, altitude
            FROM trajectories
            WHERE icao24 = :icao24
            ORDER BY last DESC
        """
        rows = self.conn.execute(sql, dict(icao24=icao24)).fetchall()
        return [
            dict(
                zip(
                    ["id", "icao24", "timestamp", "latitude", "longitude", "altitude"],
                    row,
                )
            )
            for row in rows
        ]

    async def load_all_history(self):
        icao24_list: List[str] = await rs1090_client.list_identifiers()
        for icao24 in icao24_list:
            await self._load_history(icao24)
        log.info("all history loaded from rs1090")

    async def _load_history(self, identifier: str):
        """load tracks from rs1090 and save them to local db"""
        tracks = await rs1090_client.icao24_track(identifier) or []
        log.info("total track items: %s", len(tracks))
        tracks = [
            {
                "icao24": item["icao24"],
                "last": int(item["timestamp"]),
                "latitude": item["latitude"],
                "longitude": item["longitude"],
                "altitude": item.get("altitude"),
            }
            for item in tracks
            if item.get("latitude") and item.get("longitude")
        ]
        if tracks:
            log.debug("%s", tracks[0])
        self.insert_many_with_ts_confict(tracks)


class TrajectoryChannelHandler(ChannelHandlerMixin):
    def __init__(self) -> None:
        super().__init__()

    @property
    def channel_name(self) -> str:
        return "channel:trajectory"

    def will_handle_channel(self, channel_name: str) -> bool:
        return channel_name.lower().startswith(self.channel_name)


trajectory_channel_handler = TrajectoryChannelHandler()
register_channel_handler(trajectory_channel_handler)


@trajectory_channel_handler.on_channel_event(channel_pattern="channel:streaming", event_pattern="event:select")
async def handle_streaming_select(client_id: str, message: ClientMessage) -> bool:
    log.info("TJ - %s have a new selection: %s", client_id, message.payload)
    return True


class Runner:
    def __init__(self, trajectory_channel_handler):
        self.trajectory_channel_handler = trajectory_channel_handler
        self.trajectory_channel_handler.register_channel_event_handler(
            self.handle_streaming_select, "channel:streaming", "event:select", obj=self
        )
        self.selected_icao24: Optional[str] = None

        self.running = True
        self.counter = 0
        self.task = None
        self.latest_track_ts: None | float = None
        self.trajectory_db = TrajectoryDB(delete_db=True)  # TODO default to proper value

        self.system_channel = jet1090_websocket_client.add_channel("system")
        self.system_channel.on_event("join", self.on_system_joining)
        self.system_channel.on_event("datetime", self.on_system_datetime)

        self.jet1090_data_channel: Channel = jet1090_websocket_client.add_channel("jet1090")
        self.jet1090_data_channel.on_event("join", self.on_jet1090_joining)
        self.jet1090_data_channel.on_event("data", self.on_jet1090_data)

    async def handle_streaming_select(self, client_id: str, message: ClientMessage):
        self.selected_icao24 = message.payload["icao24"]
        log.info("TJ Runner - selected_icao24 updated: %s", self.selected_icao24)

    def on_system_joining(self, join_ref, ref, channel, event, status, response):
        log.info("system, joined: %s", response)

    def on_system_datetime(self, join_ref, ref, channel, event, status, response):
        # log.info("system/datetime: %s", response)
        pass

    def on_jet1090_joining(self, join_ref, ref, channel, event, status, response):
        log.info("jet1090, joined: %s", response)

    async def on_jet1090_data(self, join_ref, ref, channel, event, status, response):
        timed_message = response.get("timed_message")

        # client side filtering by icao24
        if self.selected_icao24 is None or (
            self.selected_icao24 and (timed_message.get("icao24") != self.selected_icao24)
        ):
            # log.debug("%s, ignore %s", self.selected_icao24, timed_message.get("icao24"))
            return

        # filter on the client side: i.e df = 17
        # we are also interested in timestamp, which is always there
        if not (timed_message.get("latitude") and timed_message.get("longitude") and timed_message.get("timestamp")):
            log.debug("filtered out %s", timed_message)
            return

        includes = ["df", "icao24", "timestamp", "latitude", "longitude", "altitude"]
        item = {("last" if k == "timestamp" else k): timed_message.get(k) for k in includes}

        log.info("push to %s, %s", self.selected_icao24, item)
        await channels.publish_any(f"channel:trajectory:{item['icao24']}", "new-data", item)

    async def start_task(self) -> None:
        self.task = asyncio.create_task(self.run())
        log.debug("trajectory peristing task created")

    def persist(self, items: List[dict[str, Any]]) -> None:
        try:
            self.trajectory_db.insert_many_with_ts_confict(items)
            log.info("total %s items persisted in db", len(items))
        except Exception:
            log.exception("fail to write sqltie3 db")

    async def run(self, internal_seconds: int = 7):
        """launch job here"""
        log.info("start running ...")
        await self.system_channel.join_async()
        await self.jet1090_data_channel.join_async()

        await self.trajectory_db.load_all_history()
        log.info("start peristing ...")

        while self.running:
            items = await rs1090_client.all() or []
            log.debug("total: %s", len(items))

            items = [item for item in items if all((item.get("latitude"), item.get("longitude"), item.get("last")))]

            if self.latest_track_ts:
                log.debug(
                    "filter by latest_track_ts %s (%s)",
                    datetime.fromtimestamp(self.latest_track_ts).isoformat(),
                    self.latest_track_ts,
                )
                items = [item for item in items if item["last"] > self.latest_track_ts]

            if items:
                self.latest_track_ts = max([item["last"] for item in items])

            self.persist(items)

            # and push to client directly
            # TODO only when clients are subscribing a icao24
            # for item in items:
            #     try:
            #         # tracks = self.trajectory_db.list_tracks(item["icao24"])
            #         # await channels.publish_any(f"trajectory:{item['icao24']}", "new-data", [*tracks, item])
            #         await channels.publish_any(f"trajectory:{item['icao24']}", "new-data", item)
            #     except Exception:
            #         log.exception(f"fail to publish trajectory {item}")
            #
            # expire records every minute
            if self.counter % 60 == 0:
                self.trajectory_db.expire_records()

            self.counter += 1
            await asyncio.sleep(internal_seconds)  # one second
        log.info("persisting job done")


runner = Runner(trajectory_channel_handler)

app = FastAPI()
# Per documents, events are not fired in sub app. Sadly, `on_event` decorator won't work
# @rs1090_app.on_event('startup')


async def start() -> None:
    await runner.start_task()
    log.info("trajectory task created, %s", runner.task)


async def shutdown() -> None:
    log.info("shuting down task: %s", runner.task)
    if runner.task is None:
        log.warning("runner task is None")
        return

    if runner.task.done():
        result = runner.task.result()
        log.info("got result: %s", result)
    else:
        runner.task.cancel()
        log.warning("task is canceled")
    log.info("shutdown - publish job done")


@app.get("/icao24/{identifier}")
async def list_history_tracks(identifier: str):
    return runner.trajectory_db.list_tracks(identifier)
