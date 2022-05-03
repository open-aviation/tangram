from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import click
from atmlab.network import Network
from pymongo import MongoClient
from traffic import config
from traffic.data import ModeS_Decoder

import pandas as pd

if TYPE_CHECKING:
    from traffic.core.structure import Airport


def clean_callsign(cumul):
    callsigns = set()
    i = 0
    while i < len(cumul):
        if "callsign" in cumul[i]:
            callsign = cumul[i]["callsign"]
            if callsign in callsigns:
                del cumul[i]
                i -= 1
            else:
                callsigns.add(callsign)
        i += 1
    if len(callsigns) == 0:
        callsign = None
    else:
        callsign = callsigns.pop()
    return cumul, callsign


class FlightDumper(ModeS_Decoder):
    def __init__(
        self,
        reference: None | str | Airport | tuple[float, float] = None,
        database_name: str = "adsb"
    ) -> None:
        super().__init__(
            reference,
            expire_frequency=pd.Timedelta("1 minute"),
            expire_threshold=pd.Timedelta("10 minutes"),
        )
        client = MongoClient()
        self.network = Network()
        self.db = client.get_database(name=database_name)

    def on_expire_aircraft(self, icao: str) -> None:
        logging.info(f"expire aircraft {icao}")
        self.dump_data(icao)
        return super().on_expire_aircraft(icao)

    def on_new_aircraft(self, icao24: str) -> None:
        logging.info(f"new aircraft {icao24}")

    def dump_data(self, icao) -> None:

        cumul = self.acs[icao].cumul
        if len(cumul) == 0:
            return
        start = self.acs[icao].cumul[0]["timestamp"]
        stop = self.acs[icao].cumul[-1]["timestamp"]

        if stop - start < timedelta(minutes=1):
            return

        cumul, callsign2 = clean_callsign(cumul)
        try:
            flight_data = self.network.icao24(icao)["flightId"]
            callsign1 = flight_data["keys"]["aircraftId"]
        except Exception:
            flight_data = {}
            callsign1 = None

        callsign = callsign1 if callsign2 is None else callsign2
        if callsign is None:
            return
        dum = {
            "icao": icao,
            "callsign": callsign,
            "start": str(start),
            "stop": str(stop),
            "traj": cumul,
            "flight_data": flight_data,
        }
        try:
            self.db.tracks.insert_one(dum)
        except Exception as e:
            logging.warning(e)


@click.command()
@click.argument("source")
@click.option(
    "-f",
    "--filename",
    default="~/ADSB_EHS_RAW_%Y%m%d.csv",
    show_default=True,
    help="Filename pattern describing where to dump raw data",
)
@click.option("-v", "--verbose", count=True, help="Verbosity level")
def main(
    source: str,
    filename: str | Path = "~/ADSB_EHS_RAW_%Y%m%d_tcp.csv",
    decode_uncertainty: bool = False,
    verbose: int = 0,
) -> None:

    logger = logging.getLogger()
    if verbose == 1:
        logger.setLevel(logging.INFO)
    elif verbose > 1:
        logger.setLevel(logging.DEBUG)

    dump_file = Path(filename).with_suffix(".csv").as_posix()

    address = config.get("decoders", source)
    host_port, reference = address.split("/")
    host, port = host_port.split(":")
    decoder = FlightDumper.from_address(
        host=host,
        port=int(port),
        reference=reference,
        file_pattern=dump_file,
        uncertainty=decode_uncertainty,
    )
    decoder.decode_thread.join()
    decoder.timer_thread.join()


if __name__ == "__main__":
    main()
