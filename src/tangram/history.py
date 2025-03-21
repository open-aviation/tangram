import asyncio
import json
import logging
import pathlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any, List, Sequence

from redis.commands.timeseries import TimeSeries

from tangram.common import redis_subscriber, rs1090

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)

DEFAULT_DB_DIRECTORY = pathlib.Path("/tmp")


class HistoryDB:
    """by default, this loads data from JET1090 restful api"""

    def __new__(cls, *args, **kwargs):
        if not hasattr(cls, "instance"):
            log.debug("creating history db, %s, %s", args, kwargs)
            cls.instance = super().__new__(cls)
            log.info("HistoryDB instance created: %s", cls.instance)
        log.info("HistoryDB instance: %s, %s", cls.instance, cls.instance.get_db_file())
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
            log.info("db_file: %s", db_file)

        self.db_file = db_file
        log.info("db_file: %s", self.db_file)

        self.conn = sqlite3.connect(self.db_file)
        if not read_only:
            self.__create_tables(drop_table=drop_table)

    def get_db_file(self):
        try:
            return self.db_file
        except AttributeError:
            return None

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

    def insert_many_tracks(self, items: List[rs1090.Jet1090Data | dict[str, Any]]) -> None:
        """required fields: icao24, last, latitude, longitude, altitude
        make altitude None if it is not available in the data."""
        sql = """
            INSERT INTO trajectories (icao24, last, latitude, longitude, altitude)
            VALUES (:icao24, :last, :latitude, :longitude, :altitude)
            ON CONFLICT(icao24, last) DO NOTHING
        """
        rows = [
            {
                "icao24": item["icao24"] if isinstance(item, dict) else item.icao24,
                "last": item["last"] if isinstance(item, dict) else item.last,
                "latitude": item["latitude"] if isinstance(item, dict) else item.latitude,
                "longitude": item["longitude"] if isinstance(item, dict) else item.longitude,
                "altitude": item["altitude"] if isinstance(item, dict) else item.altitude,
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

    def list_tracks(self, icao24: str) -> List[dict[str, Any]]:
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

    def count_tracks(self, last_minutes: int = 5):
        sql = "SELECT count(DISTINCT icao24) FROM trajectories WHERE last > current_timestamp - :last_minutes * 60"
        result = self.conn.execute(sql, {"last_minutes": last_minutes}).fetchone()
        return result[0]

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


@dataclass
class State:
    icao24: str | None = None


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str], history_db: HistoryDB):
        initial_state = State()
        self.history_db = history_db  # maybe put this into `state` ?
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        message = json.loads(data)
        # log.info("channel: %s, pattern: %s", channel, pattern)

        if channel == "coordinate":
            await self.coordinate_handler(message, state)

        if channel == "altitude":
            await self.altitude_handler(message, state)

    async def coordinate_handler(self, message: dict, state: State):
        ts: TimeSeries = self.redis.ts()
        retention_msecs = 1000 * 60

        icao24 = message["icao24"]
        timestamp_ms = int(float(message["timestamp"]) * 1000)
        latitude, longitude = float(message["latitude"]), float(message["longitude"])
        record = {
            "icao24": icao24,
            "last": timestamp_ms,
            "latitude": latitude,
            "longitude": longitude,
            "altitude": None,  # no altitude from coordinate message
        }
        self.history_db.insert_many_tracks([record])
        log.debug("persiste record in db for %s", icao24)

        # EXPERIMENTAL: store latitude and longitude in redis timeseries
        latitude_key, longitude_key = f"latitude:{icao24}", f"longitude:{icao24}"
        labels = {
            "type": "latlong",
            "icao24": icao24,
        }
        if not await self.redis.exists(latitude_key):
            result = await ts.create(latitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add latitude_key %s %s", latitude_key, result)

        if not await self.redis.exists(longitude_key):
            result = await ts.create(longitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add longitude_key %s %s", longitude_key, result)

        fields = ["timestamp", "icao24", "latitude", "longitude"]
        message = {k: message[k] for k in fields}
        values: Sequence = [
            (latitude_key, timestamp_ms, latitude),
            (longitude_key, timestamp_ms, longitude),
        ]
        await ts.madd(values)

    async def altitude_handler(self, message: dict, state: State):
        ts = self.redis.ts()
        retention_msecs = 1000 * 60

        icao24 = message["icao24"]
        timestamp_ms = int(float(message["timestamp"]) * 1000)

        if message["altitude"] is None:
            return

        altitude = float(message["altitude"])

        altitude_key = f"altitude:{icao24}"
        labels = {"type": "altitude", "icao24": icao24}
        if not await self.redis.exists(altitude_key):
            result = await ts.create(altitude_key, retention_msecs=retention_msecs, labels=labels)
            log.info("add key %s %s", altitude_key, result)

        fields = ["timestamp", "icao24", "altitude"]
        message = {k: message[k] for k in fields}
        values: Sequence = [(altitude_key, timestamp_ms, altitude)]
        await ts.madd(values)


subscriber: Subscriber | None = None
load_task: asyncio.Task | None = None
expire_task: asyncio.Task | None = None


async def startup(redis_url: str, channels: List[str]) -> List[asyncio.Task | None]:
    global subscriber, load_task, expire_task
    log.info("history is starting ...")

    global subscriber, load_task, expire_task

    history_db = HistoryDB(use_memory=False)
    log.info("history db created, use_memory: %s", history_db)

    log.info("history is loading historical data ... (this takes a few more seconds.)")
    await history_db.load_all_history()
    log.info("history data loaded")

    expire_task = asyncio.create_task(history_db.expire_records_periodically())
    log.info("tasks created, %s", expire_task.get_coro())

    load_task = asyncio.create_task(history_db.load_by_restful_client())
    log.info("tasks created, %s", load_task.get_coro())

    # subscriber = Subscriber(name="history", redis_url=redis_url, channels=channels, history_db=history_db)
    # await subscriber.subscribe()
    # tangram_log.info("history is up and running, task: %s", subscriber.task.get_coro())
    # return [subscriber.task, load_task, expire_task]
    return [None, load_task, expire_task]


async def shutdown():
    log.info("history is shutting down ...")
    if load_task:
        load_task.cancel()
    if expire_task:
        expire_task.cancel()
    log.info("history exits")


async def main(redis_url, channel_csv="coordinate,altitude*"):
    channels = channel_csv.split(",")
    try:
        tasks = await startup(redis_url, channels=channels)
        tasks = [t for t in tasks if isinstance(t, asyncio.Task)]
        # gather or wait for tasks
        await asyncio.gather(*tasks)
    except Exception as exec:  # noqa
        log.exception(f"Error starting up history plugin: {exec}")
        await shutdown()


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        help="Redis url, or use REDIS_URL environment variable which take precedence, redis://host:port",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
    )
    parser.add_argument(
        "--redis-topic",
        dest="redis_topic_csv",
        help="Redis topics to linsten in CSV format, * allowed for patterns",
        default=os.getenv("REDIS_TOPIC", "coordinate,altitude*"),
    )
    args = parser.parse_args()
    asyncio.run(main(args.redis_url, args.redis_topic_csv))
