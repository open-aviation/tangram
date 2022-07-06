from __future__ import annotations

import logging
import pickle
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict

import click
import zmq
from traffic import config
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
    def __init__(
        self,
        reference: None | str | Airport | tuple[float, float] = None,
    ) -> None:
        super().__init__(
            reference,
        )
        self.name: str = ""

    # @ModeS_Decoder.on_timer("5s")
    # def prepare_request(self) -> None:
    #     t = self.traffic
    #     if t is not None:
    #         t = t.drop(set(t.data.columns) - columns, axis=1)
    #         t = t.assign(antenna=self.name)


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
    source: str = "salon",
    decode_uncertainty: bool = False,
    verbose: int = 0,
    serve_host: str | None = "127.0.0.1",
    serve_port: int | None = 5056,
    log_file: str | None = None,
) -> None:

    logger = logging.getLogger()
    if verbose == 1:
        logger.setLevel(logging.INFO)
    elif verbose > 1:
        logger.setLevel(logging.DEBUG)

    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(process)d - %(threadName)s - %(asctime)s"
        " - %(levelname)s - %(message)s"
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
    host = config.get("decoders." + source, "host")
    port = config.get("decoders." + source, "port")
    if serve_host is None:
        serve_host = config.get(
            "decoders." + source, "serve_host", fallback="127.0.0.1"
        )
    if serve_port is None:
        serve_port = int(
            config.get("decoders." + source, "serve_port", fallback=5050)
        )
    time_fmt = config.get("decoders." + source, "time_fmt", fallback="default")
    protocol = config.get("decoders." + source, "socket")
    data_path = config.get(
        "decoders." + source, "file", fallback="~/ADSB_EHS_RAW_%Y%m%d.csv"
    )
    reference = config.get("decoders." + source, "reference")
    expire_frequency = pd.Timedelta(
        config.get(
            "decoders." + source, "expire_frequency", fallback="1 minute"
        )
    )
    expire_threshold = pd.Timedelta(
        config.get(
            "decoders." + source, "expire_threshold", fallback="1 minute"
        )
    )
    dump_file = Path(data_path).with_suffix(".csv").as_posix()
    decoder = TrafficDecoder.from_address(
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
            break
        request: Dict[str, Any] = server.recv_json()
        t = decoder.traffic
        if t is not None:
            timestamp = request["payload"][0]
            t = t.query(
                f"timestamp>='{timestamp}'"
            )  # poser la question a Xavier
            if t is not None:
                t = t.drop(set(t.data.columns) - columns, axis=1)
                t = t.assign(antenna=decoder.name)
        # pyobj = zlib.compressobj(t)
        zobj = pickle.dumps(t)
        server.send(zobj)


if __name__ == "__main__":
    main()
