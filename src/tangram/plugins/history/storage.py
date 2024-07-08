#!/usr/bin/env python
# coding: utf8

import asyncio
import logging
import pathlib
import sqlite3
from datetime import datetime
from typing import List

from tangram.plugins.common import rs1090

log = logging.getLogger(__name__)


class HistoryDB:
    """by default, this loads data from Jet1090 restful api"""

    def __new__(cls, *args, **kwargs):
        if not hasattr(cls, "instance"):
            cls.instance = super().__new__(cls)
            log.debug("HistoryDB instance created: %s", cls.instance)
        log.debug("HistoryDB instance: %s", cls.instance)
        return cls.instance

    def __init__(
        self,
        use_memory: bool = True,
        db_file: str | pathlib.Path | None = None,
        directory: pathlib.Path | None = None,
        delete_db: bool = False,
        drop_table: bool = False,
        read_only: bool = False,
    ):
        self.jet1090_restful_client = rs1090.Rs1090Client()

        if db_file is not None:
            use_memory = False
        db_file = ":memory:" if use_memory else (db_file or "data.sqlite3")
        log.info("db_file: %s", db_file)

        # initialize database file and create database table.
        # By default, in current directory
        if not use_memory:
            match directory:
                case None:
                    directory = pathlib.Path.cwd()
                case directory if isinstance(directory, str):
                    directory = pathlib.Path(directory)
                case directory if not isinstance(directory, pathlib.Path):
                    log.error("directory %s must be str or pathlib.Path")

            db_file = directory / db_file

            if delete_db:
                db_file.unlink(missing_ok=True)
                log.warning("db file %s unlinked from system", db_file)

        self.conn = sqlite3.connect(db_file)
        if not read_only:
            self.__create_tables(drop_table=drop_table)

    def __create_tables(self, drop_table: bool = False):
        if drop_table:
            self.drop_trajectory_table()
            self.drop_altitude_table()
        self.create_trajectory_table()
        self.create_altitude_table()

    def drop_trajectory_table(self):
        self.conn.execute("DROP TABLE trajectories IF EXISTS;")
        log.warning("existing table trajectories removed from db")

    def create_trajectory_table(self):
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

    def drop_altitude_table(self):
        self.conn.execute("DROP TABLE altitudes IF EXISTS;")
        log.warning("existing table altitudes removed from db")

    def create_altitude_table(self):
        sql = """
            CREATE TABLE IF NOT EXISTS altitudes (
                id integer primary key autoincrement,
                icao24 text,
                last real,
                altitude real,
                UNIQUE (icao24, last)
            )
        """
        self.conn.execute(sql)

    def expire_records(self, expiration_seconds: int = 60 * 60 * 2):
        sql = f"""
            DELETE FROM trajectories WHERE UNIXEPOCH(current_timestamp) - last > {expiration_seconds};
            DELETE FROM altitudes WHERE UNIXEPOCH(current_timestamp) - last > {expiration_seconds};
        """
        self.conn.executescript(sql)
        log.info("expire records older than %s seconds", expiration_seconds)

    def insert_many_tracks(self, items: List[rs1090.Jet1090Data]) -> None:
        # if items:
        #     log.debug("%s", items[0])

        sql = """
            INSERT INTO trajectories (icao24, last, latitude, longitude, altitude)
            VALUES (:icao24, :last, :latitude, :longitude, :altitude)
            ON CONFLICT(icao24, last) DO NOTHING
        """
        rows = [
            {
                "icao24": item.icao24,
                "last": item.last,
                "latitude": item.latitude,
                "longitude": item.longitude,
                "altitude": item.altitude,
            }
            for item in items
        ]
        try:
            self.conn.executemany(sql, rows)
            self.conn.commit()
        except:  # noqa
            log.exception("fail to write db")

    def insert_many_altitudes(self, items: List[rs1090.Jet1090Data]) -> None:
        sql = """INSERT INTO altitudes (icao24, last, altitude) VALUES (:icao24, :last, :altitude) ON CONFLICT(icao24, last) DO NOTHING"""
        rows = [{"icao24": item.icao24, "last": item.last, "altitude": item.altitude} for item in items]
        try:
            self.conn.executemany(sql, rows)
            self.conn.commit()
        except:  # noqa
            log.exception("fail to write altitude into db")

    def list_tracks(self, icao24: str):
        sql = """
            SELECT id, icao24, last as timestamp, latitude, longitude, altitude
            FROM trajectories
            WHERE icao24 = :icao24
            ORDER BY last ASC
        """
        rows = self.conn.execute(sql, dict(icao24=icao24)).fetchall()
        fields = ["id", "icao24", "timestamp", "latitude", "longitude", "altitude"]
        return [dict(zip(fields, row)) for row in rows]

    def list_altitudes(self, icao24: str):
        sql = """
            SELECT id, icao24, last as timestamp, altitude
            FROM altitudes
            WHERE icao24 = :icao24
            ORDER BY last ASC
        """
        rows = self.conn.execute(sql, dict(icao24=icao24)).fetchall()
        fields = ["id", "icao24", "last", "altitude"]
        return [dict(zip(fields, row)) for row in rows]

    async def _load_history(self, identifier: str):
        """load tracks from rs1090 and save them to local db"""
        tracks: List[rs1090.Jet1090Data] = await self.jet1090_restful_client.icao24_track(identifier) or []
        log.debug("total track items: %s", len(tracks))

        tracks = [item for item in tracks if item.latitude and item.longitude]
        log.debug("loaded %s tracks with latitude/longitude", len(tracks))

        self.insert_many_tracks(tracks)

        altitudes = [item for item in tracks if item.altitude]
        log.debug("loaded %s altitudes", len(altitudes))
        self.insert_many_altitudes(altitudes)

    async def load_all_history(self):
        icao24_list: List[str] = await self.jet1090_restful_client.list_identifiers()
        for icao24 in icao24_list:
            await self._load_history(icao24)
        log.info("all history loaded from rs1090")

    async def load_by_restful_client(self, seconds_interval: int = 5):
        latest_track_ts: float = 0

        while True:
            items: List[rs1090.Jet1090Data] = await self.jet1090_restful_client.all() or []
            log.debug("total: %s", len(items))

            items = [item for item in items if all((item.latitude, item.longitude, item.last))]

            latest_track_dt_str = datetime.fromtimestamp(latest_track_ts).isoformat()
            log.debug("filter by latest_track_ts %s (%s)", latest_track_dt_str, latest_track_ts)

            items = [item for item in items if item.last > latest_track_ts]

            if items:
                latest_track_ts = max(item.last for item in items)  # noqa

            self.insert_many_tracks(items)
            await asyncio.sleep(seconds_interval)

    async def expire_records_periodically(self, seconds_expire: int = 60 * 60 * 2, seconds_interval: int = 3):
        while True:
            self.expire_records(seconds_expire)
            await asyncio.sleep(seconds_interval)
