import asyncio
import logging
import pathlib
import sqlite3
from datetime import datetime
from typing import Any, List

from fastapi import FastAPI
from tangram import websocket as channels
from tangram.plugins.common import rs1090

log = logging.getLogger(__name__)
rs1090_client = rs1090.Rs1090Client()
MEMORY_FILE = ":memory:"


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
            CONSTRAINT unique_icao24_last UNIQUE (icao24, last)
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

    def insert_many(self, items: List[dict[str, Any]]):
        sql = """
            INSERT INTO trajectories (icao24, last, latitude, longitude, altitude)
            VALUES (:icao24, :last, :latitude, :longitude, :altitude)
        """
        try:
            self.conn.executemany(sql, items)
            self.conn.commit()
        except:  # noqa
            log.exception("fail to write db")

    def insert_many_with_ts_confict(self, items: List[dict[str, Any]]) -> None:
        if items:
            log.info("%s", items[0])

        sql = """
            INSERT INTO trajectories (icao24, last, latitude, longitude, altitude)
            VALUES (:icao24, :last, :latitude, :longitude, :altitude)
            ON CONFLICT(icao24, last) DO NOTHING
        """
        # TODO conflict error:
        # sqlite3.IntegrityError: UNIQUE constraint failed: trajectories.icao24, trajectories.last
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
        log.info("history loaded for %s icao24", len(icao24_list))

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
            log.info("%s", tracks[0])
        self.insert_many_with_ts_confict(tracks)


class Runner:
    def __init__(self):
        self.running = True
        self.counter = 0
        self.task = None
        self.latest_track_ts: None | float = None
        self.trajectory_db = TrajectoryDB(delete_db=True)  # TODO default to proper value

    async def start_task(self) -> None:
        self.task = asyncio.create_task(self.run())
        log.debug("trajectory peristing task created")

    def persist(self, items: List[dict[str, Any]]) -> None:
        try:
            self.trajectory_db.insert_many(items)
            log.info("total %s items persisted in db", len(items))
        except Exception:
            log.exception("fail to write sqltie3 db")

    async def run(self, internal_seconds: int = 3):
        """launch job here"""
        log.info("start peristing ...")

        await self.trajectory_db.load_all_history()

        while self.running:
            items = await rs1090_client.all() or []
            log.info("total: %s", len(items))
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
            for item in items:
                try:
                    # tracks = self.trajectory_db.list_tracks(item["icao24"])
                    # await channels.publish_any(f"trajectory:{item['icao24']}", "new-data", [*tracks, item])
                    await channels.publish_any(f"trajectory:{item['icao24']}", "new-data", item)
                except Exception:
                    log.exception(f"fail to publish trajectory {item}")

            # expire records every minute
            if self.counter % 60 == 0:
                self.trajectory_db.expire_records()

            self.counter += 1
            await asyncio.sleep(internal_seconds)  # one second
        log.info("persisting job done")


runner = Runner()
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
