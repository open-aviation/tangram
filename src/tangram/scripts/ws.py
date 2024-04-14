from __future__ import annotations

import logging
import signal
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Optional
from warnings import simplefilter

import click
import pandas as pd
from traffic import config
from traffic.core import Traffic
from traffic.data import ModeS_Decoder

from tangram.util import geojson

if TYPE_CHECKING:
    from traffic.core.structure import Airport


# simplefilter(action='ignore', category=FutureWarning)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(filename)s:%(lineno)s - %(message)s')
_log = logging.getLogger(__name__)
# print(_log)

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
@click.option("--host", "serve_host", show_default=True, default=None, help="host address where to serve decoded information")
@click.option("--port", "serve_port", show_default=True, default=None, type=int, help="port to serve decoded information")
@click.option("-l", "--log", "log_file", default=None, help="logging information")
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(source: str = "delft", decode_uncertainty: bool = False, verbose: int = 0, serve_host: str | None = "127.0.0.1", serve_port: int | None = 5056, log_file: str | None = None) -> None:
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
        host=host, port=int(port), reference=reference, file_pattern=dump_file, uncertainty=decode_uncertainty,
        tcp=False if protocol == "UDP" else True, time_fmt=time_fmt)
    decoder.name = source
    decoder.expire_frequency = expire_frequency
    decoder.expire_threshold = expire_threshold

    def sigint_handler(signal, frame):
        # TODO threaded, waiting its exit
        decoder.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, sigint_handler)
    while True:
        if not decoder.decode_thread.is_alive():
            sys.exit("Connection dropped")

        t: Traffic | None = decoder.prepared_traffic
        if not t:
            # _log.info('nothing here, continue')
            continue

        # _log.info('%s', geojson.geojson_traffic(t))
        # _log.info('%s', geojson.geojson_turbulence(t))
        print(geojson.geojson_traffic(t))

        _log.info('type: %s', type(t))
        _log.info('type: %s, len: %s', type(t), len(t))

        # els: List[Flight] = [el for el in t]
        # el = els[0]
        # print(type(el))
        # print(el)

        # # print(el._repr_html_())
        # print(el.keys())
        # for k in el.keys():
        #     print(f"{k:16s} => {el[k]}/{type(el[k])}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print('\rbye.')
