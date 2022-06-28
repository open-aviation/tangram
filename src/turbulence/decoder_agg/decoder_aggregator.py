from __future__ import annotations

import base64
import heapq
import logging
import os
import pickle
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Thread
from typing import Callable

import click
from atmlab.network import Network
from flask import Flask, current_app
from pymongo import MongoClient
from traffic.core.traffic import Flight, Traffic

import pandas as pd
import zmq
from turbulence import config_agg
from turbulence.client.modes_decoder_client import Decoder

logger = logging.getLogger("aggregator")

mongo_uri = config_agg.get(
    "history", "database_uri", fallback="mongodb://localhost:27017/adsb"
)
expire_frequency = pd.Timedelta(
    config_agg.get("parameters", "expire_frequency", fallback="1 minute")
)
expire_threshold = pd.Timedelta(
    config_agg.get("parameters", "expire_threshold", fallback="1 minute")
)
# columns = set(config_agg.get("columns", "columns", fallback=[]))
# columns = {
#     'timestamp', 'icao24', 'altitude', 'heading',
#     'vertical_rate_barometric', 'vertical_rate_inertial',
#     'track', 'vertical_rate', 'latitude', 'longitude',
#     'callsign', 'track_rate'
# }

def clean_callsign(cumul):
    i = 0
    while i < len(cumul):
        if cumul[i].keys() == {"timestamp", "icao24", "callsign"}:
            del cumul[i]
            i -= 1
        i += 1
    return cumul


class Aggregetor:

    timer_functions: list[
        tuple[pd.Timestamp, pd.Timedelta, Callable[[Aggregetor], None]]
    ] = list()
    agg_thread: Thread
    timer_thread: Thread

    def __init__(
        self,
        decoders: dict[str, str] | str = "http://localhost:5050",
        expire_frequency: pd.Timedelta = expire_frequency,
        expire_threshold: pd.Timedelta = expire_threshold,
        database_uri: str = mongo_uri,
    ) -> None:
        if isinstance(decoders, str):
            decoders = {"": decoders}
        self.decoders: dict[str, Decoder] = {
            name: Decoder(address) for name, address in decoders.items()
        }
        self.decoders_time: dict[str, str] = {
            name: "" for name in decoders
        }
        self.running: bool = False
        self._traffic: Traffic = None
        self.pickled_traffic: str = None
        self.expire_threshold = (
            expire_threshold
            if isinstance(expire_threshold, pd.Timedelta)
            else pd.Timedelta(expire_threshold)
        )
        self.expire_frequency = (
            expire_frequency
            if isinstance(expire_frequency, pd.Timedelta)
            else pd.Timedelta(expire_frequency)
        )
        self.lock_traffic = threading.Lock()
        self.mclient = MongoClient(host=database_uri)
        self.network = Network()
        self.db = self.mclient.get_database()

    @property
    def traffic(self):
        return self._traffic

    @traffic.setter
    def traffic(self, t: Traffic) -> None:
        with self.lock_traffic:
            self._traffic = t

    def traffic_decoder(self, decoder_name: set(str)) -> Traffic | None:
        previous_endtime = self.decoders_time[decoder_name]
        traffic = self.decoders[decoder_name].traffic_records(
            start=previous_endtime
        )
        if traffic is None:
            return None
        # if previous_endtime is not None:
        #     traffic = traffic.query(f"timestamp>='{previous_endtime}'")
        if traffic is None:
            self.decoders_time[decoder_name] = ""
            return None
        self.decoders_time[decoder_name] = str(traffic.end_time)
        return traffic

    def calculate_traffic(self) -> None:
        traffic_decoders = None
        # for client in self.decoders_time.values():
        #     client.socket.send_string('traffic')
        with ThreadPoolExecutor(max_workers=4) as executor:
            traffic_decoders = list(
                executor.map(self.traffic_decoder, self.decoders.keys())
            )
        traffic_decoders = filter(lambda t: t is not None, traffic_decoders)
        t = sum(traffic_decoders)
        if t == 0 or t is None:
            return
        if self.traffic is None:
            self.traffic = t.drop_duplicates()
        else:
            self.traffic += t.drop_duplicates()

    def aggregation(self) -> None:
        self.running = True
        logger.info(f"parent process: {os.getppid()}")
        logger.info(f"process id: {os.getpid()}")
        while self.running:
            self.calculate_traffic()
            t = self.traffic
            # t = t.drop(
            #     set(t.data.columns) - columns, axis=1
            # ) if t is not None else t
            self.pickled_traffic = base64.b64encode(pickle.dumps(t)).decode(
                "utf-8"
            )
            time.sleep(4)

    @classmethod
    def on_timer(
        cls, frequency: pd.Timedelta | str
    ) -> Callable[[Callable[[Aggregetor], None]], Callable[[Aggregetor], None]]:
        now = pd.Timestamp("now", tz="utc")
        if isinstance(frequency, str):
            frequency = pd.Timedelta(frequency)

        def decorate(
            function: Callable[[Aggregetor], None]
        ) -> Callable[[Aggregetor], None]:
            logger.info(f"Schedule {function.__name__} with {frequency}")
            heapq.heappush(
                cls.timer_functions,
                (now + frequency, frequency, function),
            )
            return function

        return decorate

    def expire_aircraft(self) -> None:
        logger.info("Running expire_aircraft")

        now = pd.Timestamp("now", tz="utc")
        t = self.traffic
        if t is None:
            return
        if self.agg_thread and not self.agg_thread.is_alive():
            for icao in t.icao24:
                self.on_expire_aircraft(icao)

        for flight in t:
            if now - flight.stop >= self.expire_threshold:
                self.on_expire_aircraft(flight.icao24)

    def on_expire_aircraft(self, icao24: str) -> None:
        self.dump_data(icao24)
        self.traffic = self.traffic.query(f'icao24!="{icao24}"')

    def dump_data(self, icao) -> None:
        flight: Flight = self.traffic[icao]
        if flight is None:
            return
        start = flight.start
        stop = flight.stop

        if stop - start < pd.Timedelta(minutes=1):
            return

        callsign = flight.callsign
        if callsign is None:
            return
        if isinstance(callsign, set):
            callsign = list(callsign)[
                flight.data["callsign"].value_counts().argmax()
            ]
        try:
            flight_data = self.network.icao24(icao)["flightId"]
        except Exception:
            flight_data = {}

        data: pd.DataFrame = flight.data
        cumul = [row.dropna().to_dict() for index, row in data.iterrows()]
        cumul = clean_callsign(cumul)
        count = len(cumul)
        if count == 0:
            return
        dum = {
            "icao": icao,
            "callsign": callsign,
            "start": str(start),
            "stop": str(stop),
            "count": count,
            "traj": cumul,
            "flight_data": flight_data,
            "antenna": list(data.antenna.unique()),
        }
        try:
            self.db.tracks.insert_one(dum)
        except Exception as e:
            logger.warning(e)

    @classmethod
    def aggregate_decoders(
        cls, decoders: dict[str, str] | str = "http://localhost:5050"
    ) -> "Aggregetor":
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
                logger.info(f"Schedule {operation.__name__} at {now + delta}")
                heapq.heappush(
                    cls.timer_functions, (now + delta, delta, operation)
                )

        agg.agg_thread = Thread(target=agg.aggregation)
        agg.agg_thread.start()
        agg.timer_thread = Thread(target=timer)
        agg.timer_thread.start()
        return agg

    def stop(self) -> None:
        self.running = False
        if self.agg_thread is not None and self.agg_thread.is_alive():
            self.agg_thread.join()
        for d in self.decoders.values():
            d.stop()
        self._traffic = None
        self.timer_thread.join()
        self.mclient.close()


app_host = config_agg.get("application", "host", fallback="127.0.0.1")
app_port = int(config_agg.get("application", "port", fallback=5054))

app = Flask(__name__)


@app.route("/")
def home() -> dict[str, int]:
    return dict((f.icao24, len(f)) for f in current_app.aggd.traffic)


@app.route("/traffic")
def get_all() -> dict[str, str]:
    p = current_app.aggd.pickled_traffic
    return {"traffic": p}


@click.command()
@click.option(
    "--host",
    "serve_host",
    show_default=True,
    default=app_host,
    help="host address where to serve decoded information",
)
@click.option(
    "-l",
    "--log",
    "log_file",
    default=None,
    help="logging information",
)
@click.option(
    "--port",
    "serve_port",
    show_default=True,
    default=app_port,
    type=int,
    help="port to serve decoded information",
)
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(
    verbose: int = 0,
    serve_host: str | None = "127.0.0.1",
    serve_port: int | None = 5054,
    log_file: str | None = None,
) -> None:
    if verbose == 1:
        logger.setLevel(logging.INFO)
    elif verbose > 1:
        logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(process)d - %(threadName)s - %(asctime)s - %(levelname)s - %(message)s"
    )

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    if log_file is not None:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        logging.getLogger().addHandler(file_handler)
    decoders_address = {key: val for key, val in config_agg.items("decoders")}
    app.aggd = Aggregetor.aggregate_decoders(decoders=decoders_address)

    # def sigint_handler(signal, frame):
    #     print('KeyboardInterrupt is caught')
    #     app.aggd.stop()
    #     sys.exit(0)
    # signal.signal(signal.SIGINT, sigint_handler)

    from gevent.pywsgi import WSGIServer

    http_server = WSGIServer((serve_host, serve_port), app)
    http_server.serve_forever()
    # return app


if __name__ == "__main__":
    main()
