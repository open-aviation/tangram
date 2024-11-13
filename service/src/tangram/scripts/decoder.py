from __future__ import annotations

import logging
import pickle
from pathlib import Path
import sys
from typing import TYPE_CHECKING, Any, Dict, Optional

import click
import zmq
from traffic import config
from traffic.core import Traffic
from traffic.data import ModeS_Decoder

import pandas as pd

if TYPE_CHECKING:
    from traffic.core.structure import Airport

_log = logging.getLogger(__name__)

columns = set(config.get("columns", "columns", fallback=[]))
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


class TrafficDecoder(ModeS_Decoder):
    def __init__(self, reference: None | str | Airport | tuple[float, float] = None) -> None:
        super().__init__(reference)

        self.name: str = ""
        self.prepared_traffic: Optional[Traffic] = None

    @ModeS_Decoder.on_timer("2s")
    def prepare_request(self) -> None:
        t = self.traffic
        if t is not None:
            # t = t.drop(set(t.data.columns) - columns, axis=1)
            t = t.assign(antenna=self.name)
        self.prepared_traffic = t


@click.command()
@click.argument("source")
@click.option(
    "--host",
    "serve_host",
    show_default=True,
    default=None,
    help="host address where to serve decoded information",
)
@click.option(
    "--port",
    "serve_port",
    show_default=True,
    default=None,
    type=int,
    help="port to serve decoded information",
)
@click.option(
    "-l",
    "--log",
    "log_file",
    default=None,
    help="logging information",
)
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(
    source: str = "delft",
    decode_uncertainty: bool = False,
    verbose: int = 0,
    serve_host: str | None = "127.0.0.1",
    serve_port: int | None = 5056,
    log_file: str | None = None,
) -> None:
    if verbose == 1:
        _log.setLevel(logging.INFO)
    elif verbose > 1:
        _log.setLevel(logging.DEBUG)
    _log.handlers.clear()

    formatter = logging.Formatter(
        "%(process)d - %(threadName)s - %(asctime)s"
        " - %(levelname)s - %(message)s"
    )

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

    host = config.get("decoders." + source, "host")
    port = config.get("decoders." + source, "port")
    if serve_host is None:
        serve_host = config.get("decoders." + source, "serve_host")
    if serve_port is None:
        serve_port = config.getint("decoders." + source, "serve_port")
    time_fmt = config.get("decoders." + source, "time_fmt", fallback="default")
    protocol = config.get("decoders." + source, "socket", fallback="TCP")
    data_path = config.get("decoders." + source, "file")
    reference = config.get("decoders." + source, "reference")
    expire_frequency = pd.Timedelta(config.get("decoders." + source, "expire_frequency", fallback="1 minute"))
    expire_threshold = pd.Timedelta(config.get("decoders." + source, "expire_threshold", fallback="1 minute"))
    dump_file = Path(data_path).as_posix()

    decoder: TrafficDecoder = TrafficDecoder.from_address(
        host=host,
        port=int(port),
        reference=reference,
        file_pattern=dump_file,
        uncertainty=decode_uncertainty,
        tcp=False if protocol == "UDP" else True,
        time_fmt=time_fmt,
    )
    decoder.name = source
    decoder.expire_frequency = expire_frequency
    decoder.expire_threshold = expire_threshold

    context = zmq.Context()
    server = context.socket(zmq.REP)
    server.bind(f"tcp://{serve_host}:{serve_port}")

    # def sigint_handler(signal, frame):
    #     print('KeyboardInterrupt is caught')
    #     server.close()
    #     context.term()
    #     decoder.stop()
    #     sys.exit(0)

    # signal.signal(signal.SIGINT, sigint_handler)
    while True:
        if not decoder.decode_thread.is_alive():
            server.setsockopt(zmq.LINGER, 0)
            server.close()
            context.term()
            sys.exit("Connection dropped")

        # zmq_soket.py, DecoderSocket::traffic_socket
        # only payload.0, as starting timestamp, is used. Filter data starting from `now` timestamp.
        # request = {
        #     "origin": __name__,
        #     "timestamp": str(pd.Timestamp("now", tz="utc")),
        #     "payload": [str(start), "traffic"],
        # }
        request: Dict[str, Any] = server.recv_json()
        t = decoder.prepared_traffic
        if t is not None:
            timestamp = request["payload"][0]
            # poser la question a Xavier
            t = t.query(f"timestamp>='{timestamp}'")

        zobj = pickle.dumps(t)
        server.send(zobj)


if __name__ == "__main__":
    main()
