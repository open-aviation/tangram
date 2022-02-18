import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone

import pandas as pd
from traffic.data import ModeS_Decoder

from pymongo import MongoClient
from atmlab.network import Network


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
    return cumul


class TestClient(ModeS_Decoder):
    @classmethod
    def start_live(cls, host: str, port: int, reference: str):
        decoder = cls.from_address(host, port, reference)
        decoder.launch_te()
        return decoder

    def launch_te(self):
        client = MongoClient()
        self.network = Network()

        self.db = client.get_database(name="turbulence")
        executor = ThreadPoolExecutor(max_workers=4)
        executor.submit(self.clean_decoder)

    def dump_data(self, icao):

        cumul = self.acs[icao].cumul
        start = self.acs[icao].cumul[0]["timestamp"]
        stop = self.acs[icao].cumul[-1]["timestamp"]

        try:
            flight_data = self.network.icao24(icao)["flightId"]
            callsign = flight_data["keys"]["aircraftId"]
        except Exception as e:
            flight_data = {}
            callsign = None

        if stop - start < timedelta(minutes=1) and len(flight_data) == 0:
            return

        cumul = clean_callsign(cumul)

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
            print(e)

    def clean_decoder(self):
        time.sleep(2)
        while len(self.acs.keys()) != 0:
            time.sleep(60)
            for icao in list(self.acs.keys()):
                if len(self.acs[icao].cumul) > 0:
                    if pd.Timestamp("now", tzinfo=timezone.utc) - self.acs[
                        icao
                    ].cumul[-1]["timestamp"] >= timedelta(minutes=30):

                        with self.acs[icao].lock:
                            self.dump_data(icao)
                            del self.acs[icao]
