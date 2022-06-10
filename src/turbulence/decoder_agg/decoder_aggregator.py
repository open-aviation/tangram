from __future__ import annotations

import base64
import heapq
import logging
import os
import pickle
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Thread
from typing import Callable

import click
from flask import Flask, current_app
from traffic.core.traffic import Traffic
from waitress import serve

import pandas as pd
from turbulence import config_turb
from turbulence.client.modes_decoder_client import Decoder

logger = logging.getLogger('waitress')
logger.setLevel(logging.INFO)


class Aggregetor:

    timer_functions: list[
        tuple[pd.Timestamp, pd.Timedelta, Callable[[Aggregetor], None]]
    ] = list()
    agg_thread: Thread
    timer_thread: Thread

    def __init__(
        self,
        decoders: dict[str, str] | str = "http://localhost:5050",
        expire_threshold: str | pd.Timedelta = pd.Timedelta("1 minute"),
        expire_frequency: str | pd.Timedelta = pd.Timedelta("1 minute"),
    ) -> None:
        if isinstance(decoders, str):
            decoders = {"": decoders}
        self.decoders: dict[str, Decoder] = {
            name : Decoder(address) for name, address in decoders.items()
        }
        self.decoders_time: dict[str, pd.Timestamp] = {
            name : None for name in decoders
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

    @property
    def traffic(self):
        return self._traffic

    @traffic.setter
    def traffic(self, t: Traffic) -> None:
        with self.lock_traffic:
            self._traffic = t
        # if self._traffic is None:
        #     self._traffic = t
        # else:
        #     self._traffic = self._traffic + t if t is not None else self._traffic

    def traffic_decoder(self, decoder_name : str) -> Traffic | None:
        traffic_pickled = (
            self.decoders[decoder_name].traffic_records()["traffic"]
        )
        if traffic_pickled is None:
            return None
        try:
            traffic = pickle.loads(base64.b64decode(traffic_pickled.encode()))
        except Exception as e:
            logging.warning("pickle: " + str(e))
            return None
        if traffic is None:
            return None
        previous_endtime = self.decoders_time[decoder_name]
        self.decoders_time[decoder_name] = traffic.end_time
        if previous_endtime is not None:
            traffic = traffic.query(f"timestamp>='{previous_endtime}'")
        return traffic.assign(
            antenna=decoder_name
        )

    def calculate_traffic(self) -> None:
        traffic_decoders = None
        with ThreadPoolExecutor(max_workers=4) as executor:
            traffic_decoders = list(
                executor.map(self.traffic_decoder, self.decoders)
            )
        traffic_decoders = filter(lambda t: t is not None, traffic_decoders)
        t = sum(traffic_decoders)
        if t == 0 or t is None:
            return
        if self.traffic is None:
            self.traffic = t
        else:
            self.traffic += t

    def aggregation(self) -> None:
        self.running = True
        print('parent process:', os.getppid())
        print('process id:', os.getpid())
        while self.running:
            self.calculate_traffic()
            time.sleep(5)
            self.pickled_traffic = base64.b64encode(
                pickle.dumps(self.traffic)
            ).decode('utf-8')

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
            logging.info(f"Schedule {function.__name__} with {frequency}")
            heapq.heappush(
                cls.timer_functions,
                (now + frequency, frequency, function),
            )
            return function

        return decorate

    def expire_aircraft(self) -> None:
        logging.info("Running expire_aircraft")

        now = pd.Timestamp("now", tz="utc")
        t = self.traffic
        if self.agg_thread and not self.agg_thread.is_alive():
            for icao in t.icao24:
                self.on_expire_aircraft(icao)

        for flight in t:
            if now - flight.stop >= self.expire_threshold:
                self.on_expire_aircraft(flight.icao24)

    def on_expire_aircraft(self, icao: str) -> None:
        t = self.traffic
        self.traffic = t.query('icao24!="398895"')

    @classmethod
    def aggregate_decoders(
        cls,
        decoders: dict[str, str] | str = "http://localhost:5050"
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
                logging.info(f"Schedule {operation.__name__} at {now + delta}")
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

    def __del__(self) -> None:
        self.stop()
        self.timer_thread.join()


app_host = "127.0.0.1"  # config_decoder.get("application", "host", fallback="127.0.0.1")
app_port = 5054  # int(config_decoder.get("application", "port", fallback=5050))


@click.command()
@click.option(
    "--host",
    "serve_host",
    show_default=True,
    default=app_host,
    help="host address where to serve decoded information",
)
@click.option(
    "--port",
    "serve_port",
    show_default=True,
    default=app_port,
    type=int,
    help="port to serve decoded information",
)
# @click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(
    # verbose: int = 0,
    serve_host: str | None = "127.0.0.1",
    serve_port: int | None = 5050,
) -> None:

    # logger = logging.getLogger()
    # if verbose == 1:
    #     logger.setLevel(logging.INFO)
    # elif verbose > 1:
    #     logger.setLevel(logging.DEBUG)
    decoders_address = {
        key : val for key, val in config_turb.items("decoders")
    }
    app.aggd = Aggregetor.aggregate_decoders(decoders=decoders_address)
    # flask_thread = threading.Thread(
    #     target=serve,
    #     daemon=False,
    #     kwargs=dict(
    #         app=app,
    #         host=serve_host,
    #         port=serve_port,
    #         threads=8
    #     ),
    # )
    serve(
        app=app,
        host=serve_host,
        port=serve_port
    )


app = Flask(__name__)


# @app.route("/")
# def home() -> dict[str, int]:
#     i = current_app.aggd.traffic.icao24
#     return {}#dict((key, len(current_app.aggd.traffic[i])) for key in i)


@app.route("/traffic")
def get_all() -> dict[str, str]:
    p = current_app.aggd.pickled_traffic
    return {"traffic": p}


if __name__ == "__main__":
    main()


# def __main__():
#     a = Aggregetor()
#     q = Queue()
#     pro = Process(target=a.aggregate_decoders, args=(q,))
#     pro.start()
#     print(q.get())
#     a.stop()
#     pro.join()

