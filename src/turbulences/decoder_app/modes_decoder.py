from __future__ import annotations

import base64
import logging
import pickle
import threading
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import click
from atmlab.network import Network
from flask import Flask, current_app
from pymongo import MongoClient
from traffic.core import Flight
from traffic.data import ModeS_Decoder

import pandas as pd
from turbulences import config_decoder

if TYPE_CHECKING:
    from traffic.core.structure import Airport

mongo_uri = config_decoder.get(
    "database",
    "database_uri",
    fallback="mongodb://localhost:27017/adsb"
)
expire_frequency = pd.Timedelta(
    config_decoder.get("parameters", "expire_frequency", fallback="1 minute")
)
expire_threshold = pd.Timedelta(
    config_decoder.get("parameters", "expire_threshold", fallback="1 minute")
)


def clean_callsign(cumul):
    i = 0
    while i < len(cumul):
        if cumul[i].keys() == {'timestamp', 'icao24', 'callsign'}:
            del cumul[i]
            i -= 1
        i += 1
    return cumul


class TrafficDecoder(ModeS_Decoder):
    def __init__(
        self,
        reference: None | str | Airport | tuple[float, float] = None,
        database_uri: str = mongo_uri,
        expire_frequency: pd.Timedelta = expire_frequency,
        expire_threshold: pd.Timedelta = expire_threshold,
        name: str = 'toulouse'
    ) -> None:
        super().__init__(
            reference,
            expire_frequency=expire_frequency,
            expire_threshold=expire_threshold,
        )
        client = MongoClient(host=database_uri)
        self.network = Network()
        self.db = client.get_database()
        self.name = name

    def on_expire_aircraft(self, icao: str) -> None:
        logging.info(f"expire aircraft {icao}")
        self.dump_data(icao)
        return super().on_expire_aircraft(icao)

    def on_new_aircraft(self, icao24: str) -> None:
        logging.info(f"new aircraft {icao24}")

    def dump_data(self, icao) -> None:
        flight: Flight = self[icao]
        if flight is None:
            return
        start = flight.start
        stop = flight.stop

        if stop - start < timedelta(minutes=1):
            return

        callsign = flight.callsign
        if callsign is None:
            return
        if isinstance(callsign, set):
            callsign = list(flight.callsign)[
                flight.data["callsign"].value_counts().argmax()
            ]
        try:
            flight_data = self.network.icao24(icao)["flightId"]
        except Exception:
            flight_data = {}

        data = flight.data
        cumul = [
            row.dropna().to_dict()
            for index, row in data.iterrows()
        ]
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
            "antenna": self.name
        }
        try:
            self.db.tracks.insert_one(dum)
        except Exception as e:
            logging.warning(e)


app_host = config_decoder.get("application", "host", fallback="127.0.0.1")
app_port = int(config_decoder.get("application", "port", fallback=5050))
data_path = config_decoder.get(
    "file",
    "path_data",
    fallback="~/ADSB_EHS_RAW_%Y%m%d.csv"
)


@click.command()
@click.argument("source")
@click.option(
    "-f",
    "--filename",
    default=data_path,
    show_default=True,
    help="Filename pattern describing where to dump raw data",
)
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
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(
    source: str = 'toulouse',
    filename: str | Path = "~/ADSB_EHS_RAW_%Y%m%d_tcp.csv",
    decode_uncertainty: bool = False,
    verbose: int = 0,
    serve_host: str | None = "127.0.0.1",
    serve_port: int | None = 5050,
) -> None:

    logger = logging.getLogger()
    if verbose == 1:
        logger.setLevel(logging.INFO)
    elif verbose > 1:
        logger.setLevel(logging.DEBUG)

    dump_file = Path(filename).with_suffix(".csv").as_posix()
    address = config_decoder.get("decoders", source)
    host_port, reference = address.split("/")
    host, port = host_port.split(":")
    app.decoder = TrafficDecoder.from_address(
        host=host,
        port=int(port),
        reference=reference,
        file_pattern=dump_file,
        uncertainty=decode_uncertainty,
    )
    flask_thread = threading.Thread(
        target=app.run,
        daemon=True,
        kwargs=dict(
            host=serve_host,
            port=serve_port,
            threaded=True,
            debug=False,
            use_reloader=False,
        ),
    )
    flask_thread.start()


app = Flask(__name__)


@app.route("/")
def home() -> dict[str, int]:
    d = dict(current_app.decoder.acs)
    return dict((key, len(aircraft.cumul)) for (key, aircraft) in d.items())


@app.route("/traffic")
def get_all() -> dict[str, str]:
    t = current_app.decoder.traffic
    pickled_traffic = base64.b64encode(pickle.dumps(t)).decode('utf-8')
    return {"traffic": pickled_traffic}


if __name__ == "__main__":
    main()
