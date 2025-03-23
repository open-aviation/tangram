import asyncio
import logging
import pathlib
import sqlite3
from datetime import UTC, datetime
from typing import Any, ClassVar, List, NoReturn, Self

from tangram.common import rs1090

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)

DEFAULT_DB_DIRECTORY = pathlib.Path("/tmp")


class StateVectorDB:
    """by default, this loads data from JET1090 restful api"""

    _instance: ClassVar[None | Self] = None

    def __new__(cls, *args: Any, **kwargs: Any) -> Self:
        if cls._instance is None:
            log.debug("creating history db, %s, %s", args, kwargs)
            cls._instance = super().__new__(cls)
            log.info("HistoryDB instance created: %s", cls._instance)
        log.info(
            "HistoryDB instance: %s, %s",
            cls._instance,
            cls._instance.get_db_file(),
        )
        return cls._instance

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

        if use_memory:
            db_file = ":memory:"
        else:
            db_file = db_file or "data.sqlite3"

        # initialize database file and create database table.
        # By default, in current directory
        if not use_memory:
            match directory:
                case None:
                    directory = DEFAULT_DB_DIRECTORY
                case directory if isinstance(directory, str):
                    directory = pathlib.Path(directory)
                case directory if not isinstance(directory, pathlib.Path):
                    log.error("directory %s must be str or pathlib.Path")

            db_file = directory / db_file

            if delete_db:
                db_file.unlink(missing_ok=True)
                log.warning("db file %s unlinked from system", db_file)

        self.db_file = db_file
        log.info("db_file: %s", self.db_file)

        self.conn = sqlite3.connect(self.db_file)
        if not read_only:
            self.__create_tables(drop_table=drop_table)

    def get_db_file(self) -> pathlib.Path | str | None:
        try:
            return self.db_file
        except AttributeError:
            return None

    def __create_tables(self, drop_table: bool = False) -> None:
        if drop_table:
            self.drop_trajectory_table()
            # self.drop_altitude_table()

        self.create_trajectory_table()
        # self.create_altitude_table()

    def drop_trajectory_table(self) -> None:
        self.conn.execute("DROP TABLE trajectories IF EXISTS;")
        log.warning("existing table trajectories removed from db")

    def create_trajectory_table(self) -> None:
        sql = """
          CREATE TABLE IF NOT EXISTS trajectories (
            id integer primary key autoincrement,
            icao24 text,
            timestamp real,
            last real,
            latitude real,
            longitude real,
            altitude real default null,
            UNIQUE (icao24, last)
          )
        """
        self.conn.execute(sql)

    # def drop_altitude_table(self):
    #     self.conn.execute("DROP TABLE altitudes IF EXISTS;")
    #     log.warning("existing table altitudes removed from db")

    # def create_altitude_table(self):
    #     sql = """
    #         CREATE TABLE IF NOT EXISTS altitudes (
    #             id integer primary key autoincrement,
    #             icao24 text,
    #             last real,
    #             altitude real,
    #             UNIQUE (icao24, last)
    #         )
    #     """
    #     self.conn.execute(sql)

    def expire_records(self, expiration_seconds: int = 60 * 60 * 2) -> None:
        sql = f"""
            DELETE FROM trajectories
              WHERE UNIXEPOCH(current_timestamp) - last > {expiration_seconds};
        """
        self.conn.executescript(sql)
        log.info("expire records older than %s seconds", expiration_seconds)

    def insert_tracks(self, items: List[rs1090.Jet1090Data | dict[str, Any]]) -> None:
        """required fields: icao24, last, latitude, longitude, altitude
        make altitude None if it is not available in the data."""

        sql = """
            INSERT INTO trajectories
              (icao24, timestamp, last, latitude, longitude, altitude)
            VALUES (:icao24, :timestamp, :last, :latitude, :longitude, :altitude)
            ON CONFLICT(icao24, last) DO NOTHING
        """
        rows = [
            {
                "icao24": item["icao24"] if isinstance(item, dict) else item.icao24,
                "timestamp": item["timestamp"]
                if isinstance(item, dict)
                else item.timestamp,
                "last": item["last"] if isinstance(item, dict) else item.last,
                "latitude": item["latitude"]
                if isinstance(item, dict)
                else item.latitude,
                "longitude": item["longitude"]
                if isinstance(item, dict)
                else item.longitude,
                "altitude": item["altitude"]
                if isinstance(item, dict)
                else item.altitude,
            }
            for item in items
        ]
        try:
            self.conn.executemany(sql, rows)
            self.conn.commit()
        except Exception:
            log.exception("fail to write db")

    async def list_trajectory(self, icao24: str) -> List[dict[str, Any]]:
        sql = """
            SELECT id, icao24, timestamp, last, latitude, longitude, altitude
            FROM trajectories
            WHERE icao24 = :icao24
            ORDER BY last ASC
        """
        rows = self.conn.execute(sql, dict(icao24=icao24)).fetchall()
        fields = [
            "id",
            "icao24",
            "timestamp",
            "last",
            "latitude",
            "longitude",
            "altitude",
        ]
        return [dict(zip(fields, row)) for row in rows]

    def count_planes(self, last_minutes: int = 5) -> Any:
        sql = """SELECT count(DISTINCT icao24) FROM trajectories
                   WHERE last > current_timestamp - :last_minutes * 60"""
        result = self.conn.execute(sql, {"last_minutes": last_minutes}).fetchone()
        return result[0]

    async def load_one_history(self, identifier: str) -> None:
        """load tracks from rs1090 and save them to local db"""
        tracks: List[rs1090.Jet1090Data] = (
            await self.jet1090_restful_client.icao24_track(identifier) or []
        )
        log.debug("total track items: %s", len(tracks))

        tracks = [item for item in tracks if item.latitude and item.longitude]
        log.debug("loaded %s tracks with latitude/longitude", len(tracks))

        self.insert_tracks(tracks)  # type: ignore

    async def load_all_history(self) -> None:
        icao24_list: List[str] = await self.jet1090_restful_client.list_identifiers()
        for icao24 in icao24_list:
            await self.load_one_history(icao24)
        log.info("all history loaded from rs1090")

    async def load_by_restful_client(self, seconds_interval: int = 5) -> NoReturn:
        latest_track_ts: float = 0

        while True:
            items: List[rs1090.Jet1090Data] = (
                await self.jet1090_restful_client.all() or []
            )
            log.debug("total: %s", len(items))

            items = [
                item
                for item in items
                if all((item.latitude, item.longitude, item.last))
            ]

            latest_track_dt_str = datetime.fromtimestamp(
                latest_track_ts, UTC
            ).isoformat()

            log.debug(
                "filter by latest_track_ts %s (%s)",
                latest_track_dt_str,
                latest_track_ts,
            )

            items = [
                item
                for item in items
                if item.last is not None and item.last > latest_track_ts
            ]

            if items:
                latest_track_ts = max(
                    item.last for item in items if item.last is not None
                )

            self.insert_tracks(items)  # type: ignore
            await asyncio.sleep(seconds_interval)

    async def expire_records_periodically(
        self,
        seconds_expire: int = 60 * 60 * 2,
        seconds_interval: int = 3,
    ) -> NoReturn:
        while True:
            self.expire_records(seconds_expire)
            await asyncio.sleep(seconds_interval)
