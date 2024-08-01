from __future__ import annotations

import heapq
import logging
import os
import pickle
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from math import ceil
from threading import Thread
from typing import Callable, Generator, Optional, Set

import click
import numpy as np
import pandas as pd
import zmq
from flask import Flask
from pymongo import MongoClient
from pymongo.errors import DocumentTooLarge, OperationFailure
from tangram.util.zmq_sockets import DecoderSocket
from traffic import config
from traffic.core.traffic import Flight, Traffic
from waitress import serve

from atmlab.network import Network

_log = logging.getLogger(__name__)

# columns = set(config.get("columns", "columns", fallback=[]))
columns = {
    "timestamp",
    "icao24",
    "altitude",
    "heading",
    "vertical_rate_barometric",
    "vertical_rate_inertial",
    "track",
    "vertical_rate",
    "latitude",
    "longitude",
    "callsign",
    "track_rate",
}


def check_insert(chuck: np.ndarray) -> Generator:
    number_chunks = ceil(chuck.nbytes / 16793598)
    k, m = divmod(len(chuck), number_chunks)
    return (
        chuck[i * k + min(i, m) : (i + 1) * k + min(i + 1, m)]
        for i in range(number_chunks)
    )


class Aggregator:
    timer_functions: list[
        tuple[pd.Timestamp, pd.Timedelta, Callable[[Aggregator], None]]
    ] = list()
    agg_thread: Thread
    timer_thread: Thread
    dump_database: bool = True

    def __init__(self, decoders: dict[str, str] | str) -> None:
        if isinstance(decoders, str):
            decoders = {"": decoders}
        self.decoders: dict[str, DecoderSocket] = {
            name: DecoderSocket(address) for name, address in decoders.items()
        }
        self.decoders_time: dict[str, int] = {
            name: pd.Timestamp(0, tz="utc") for name in decoders
        }
        self.expire_frequency = pd.Timedelta(
            config.get("aggregator", "expire_frequency", fallback="1 minute")
        )
        self.expire_threshold = pd.Timedelta(
            config.get("aggregator", "expire_threshold", fallback="1 minute")
        )
        database_uri = config.get(
            "aggregator",
            "database_uri",
            fallback="mongodb://localhost:27017/adsb",
        )
        self.state_vector = {}
        # self.mclient = MongoClient(host=database_uri)
        self.network = Network()
        # self.db = self.mclient.get_database()
        self.running: bool = False
        self._traffic: Optional[Traffic] = None
        self.pickled_traffic: bytes = pickle.dumps(None)
        self.lock_traffic = threading.Lock()

    @property
    def traffic(self) -> Optional[Traffic]:
        return self._traffic

    @traffic.setter
    def traffic(self, t: Optional[Traffic]) -> None:
        with self.lock_traffic:
            self._traffic = t

    def update_state(self):
        if self.traffic is None:
            return {}
        return (
            self.traffic.data.groupby("icao24", as_index=False)
            .tail(50)
            .groupby("icao24", as_index=False)[self.traffic.data.columns]
            .ffill()
            .groupby("icao24", as_index=False)
            .last()
            .to_json(orient="records")
        )

    def traffic_decoder(self, decoder_name: str) -> Optional[Traffic]:
        previous_endtime = self.decoders_time[decoder_name]
        t: Optional[Traffic] = self.decoders[decoder_name].traffic_records(
            start=previous_endtime
        )
        _log.warning(
            f"[{decoder_name}]: "
            f"received: {len(t) if t is not None else 0} "
            f"start: {t.start_time if t is not None else None} "
        )
        if t is None:
            self.decoders_time[decoder_name] = pd.Timestamp(0, tz="utc")
            return None
        self.decoders_time[decoder_name] = t.end_time
        return t.assign(decoder=decoder_name)

    def calculate_traffic(self) -> None:
        max_workers: int = len(self.decoders)
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="agg_traffic") as executor:
            traffic_decoders = list(executor.map(self.traffic_decoder, self.decoders.keys()))

        t = sum(t for t in traffic_decoders if t is not None)
        if t == 0 or t is None:
            return

        if self.traffic is None:
            self.traffic = t
        else:
            self.traffic += t

    def aggregation(self) -> None:
        self.running = True
        _log.info(f"parent process: {os.getppid()}")
        _log.info(f"process id: {os.getpid()}")
        # updatestate_thread = Thread()
        while self.running:
            self.calculate_traffic()
            self.state_vector = self.update_state()
            t = self.traffic
            t = (
                t.drop(set(t.data.columns) - columns, axis=1)
                if t is not None
                else t
            )
            self.pickled_traffic = pickle.dumps(t)

    @classmethod
    def on_timer(
        cls, frequency: pd.Timedelta | str
    ) -> Callable[[Callable[[Aggregator], None]], Callable[[Aggregator], None]]:
        now = pd.Timestamp("now", tz="utc")
        if isinstance(frequency, str):
            frequency = pd.Timedelta(frequency)

        def decorate(
            function: Callable[[Aggregator], None]
        ) -> Callable[[Aggregator], None]:
            heapq.heappush(
                cls.timer_functions,
                (now + frequency, frequency, function),
            )
            return function

        return decorate

    def expire_aircraft(self) -> None:
        now = pd.Timestamp("now", tz="utc")
        t = self.traffic
        if t is None:
            return
        if self.agg_thread and not self.agg_thread.is_alive():
            for icao in t.icao24:
                self.on_expire_aircraft(icao)
        expired_flights = (
            t.groupby(["icao24", "callsign"])["timestamp"]
            .max()
            .loc[lambda x: now - x >= self.expire_threshold]
            .index
        )
        for flight in expired_flights:
            self.on_expire_aircraft(flight[0], flight[1])

    def on_expire_aircraft(
        self, icao24: str | Set[str] | None, callsign: str | Set[str] | None
    ) -> None:
        if icao24 is None:
            return
        if Aggregator.dump_database:
            self.dump_data(icao24)
        self.traffic = self.traffic.query(f'icao24!="{icao24}"')

    def dump_data(self, icao: str | Set[str]) -> None:
        """documentation"""
        flight: Optional[Flight] = self.traffic[icao]
        if flight is None:
            return
        start = flight.start
        stop = flight.stop

        if stop - start < pd.Timedelta(minutes=1):
            return
        name_change = {
            "timestamp": "ts",
            "altitude": "alt",
            "heading": "hdg",
            "vertical_rate_barometric": "vrb",
            "vertical_rate_inertial": "vri",
            "track": "trk",
            "track_rate": "trkr",
            "vertical_rate": "vr",
            "latitude": "lat",
            "longitude": "lon",
        }
        droped_columns = ["callsign", "icao24", "antenna"]
        callsign = flight.callsign
        if callsign is None:
            return
        if isinstance(callsign, set):
            callsign = list(callsign)
            droped_columns = ["icao24", "antenna"]
        # try:
        #     flight_data = self.network.icao24(icao)["flightId"]
        # except (RequestException):
        flight_data = {}

        cumul: pd.DataFrame = (
            flight.data.dropna(
                subset=set(flight.data.columns)
                - {"timestamp", "callsign", "icao24", "antenna"},
                how="all",
            )
            .drop(columns=droped_columns)
            .rename(columns=name_change)
        )
        count = len(cumul)
        if count == 0:
            return

        for i in check_insert(cumul.values):
            dum = {
                "icao": icao,
                "callsign": callsign,
                "start": str(start),
                "stop": str(stop),
                "flight_data": flight_data,
                "antenna": list(flight.data.antenna.unique()),
                "columns": list(cumul.columns),
                "count": len(i),
                "traj": i.tolist(),
            }
            try:
                pass
                # self.db.tracks.insert_one(dum)
            except (OperationFailure, DocumentTooLarge) as e:
                _log.warning(str(icao) + ":" + str(count) + ":" + str(e))

    @classmethod
    def from_decoders(cls, decoders: dict[str, str] | str) -> "Aggregator":
        agg = cls(decoders)

        def timer() -> None:
            assert agg.agg_thread is not None
            cls.on_timer(agg.expire_frequency)(cls.expire_aircraft)

            while agg.agg_thread.is_alive():
                now = pd.Timestamp("now", tz="utc")
                t, delta, operation = heapq.heappop(cls.timer_functions)

                if now < t:
                    wait = t - now
                    time.sleep(wait.total_seconds())

                now = pd.Timestamp("now", tz="utc")
                operation(agg)
                # _log.info(f"Schedule {operation.__name__} at {now + delta}")
                heapq.heappush(
                    cls.timer_functions, (now + delta, delta, operation)
                )

        agg.agg_thread = Thread(target=agg.aggregation)
        agg.agg_thread.start()
        agg.timer_thread = Thread(target=timer)
        agg.timer_thread.start()
        return agg

    def stop(self) -> None:
        """documentation"""
        self.running = False
        if self.agg_thread is not None and self.agg_thread.is_alive():
            self.agg_thread.join()
        for d in self.decoders.values():
            d.stop()
        self._traffic = None
        self.timer_thread.join()
        # self.mclient.close()


@click.command()
@click.option("--with-flask", "flask", is_flag=True, show_default=True, default=False, help="activate flask and desactivate zmq")
@click.option("--host", "serve_host", show_default=True, default=None, help="host address where to serve decoded information")
@click.option("-l", "--log", "log_file", default=None, help="logging information")
@click.option("--port", "serve_port", show_default=True, default=None, type=int, help="port to serve decoded information")
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(serve_host: str | None, serve_port: int | None, flask: bool, log_file: str | None, verbose: int = 0) -> None:
    if verbose == 1:
        _log.setLevel(logging.INFO)
    elif verbose > 1:
        _log.setLevel(logging.DEBUG)
    _log.handlers.clear()

    formatter = logging.Formatter("%(process)d - %(threadName)s - %(asctime)s - %(levelname)s - %(message)s")

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)
    console_handler.setFormatter(formatter)
    _log.addHandler(console_handler)

    if log_file is not None:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        _log.addHandler(file_handler)
        logging.getLogger().addHandler(file_handler)

    # decoder config
    decoders_address = {}
    agg_decoders = config.get("aggregator", "decoders", fallback="").split()
    for i in config.sections():
        if i.startswith("decoders"):
            name = i.split(".")[1]
            if name in agg_decoders or len(agg_decoders) == 0:
                host = config.get(i, "serve_host")
                port = config.get(i, "serve_port")
                decoders_address[name] = f"tcp://{host}:{port}"

    if serve_host is None:
        serve_host = config.get("aggregator", "serve_host")
    if serve_port is None:
        serve_port = config.getint("aggregator", "serve_port")

    Aggregator.dump_database = not flask
    aggd = Aggregator.from_decoders(decoders=decoders_address)

    # def sigint_handler(signal, frame):
    #     print('KeyboardInterrupt is caught')
    #     app.aggd.stop()
    #     sys.exit(0)
    # signal.signal(signal.SIGINT, sigint_handler)

    if not flask:
        context = zmq.Context()
        server = context.socket(zmq.REP)
        _log.info('binding to %s:%s ...', serve_host, serve_port)
        server.bind(f"tcp://{serve_host}:{serve_port}")
        while True:
            server.recv_multipart()
            server.send(aggd.pickled_traffic)
    else:
        from flask import Response

        app = Flask(__name__)

        @app.route("/")
        def home() -> dict[str, int]:
            return Response(aggd.state_vector, mimetype="application/json")

        serve(app=app, host=serve_host, port=serve_port, _quiet=False)


if __name__ == "__main__":
    main()
