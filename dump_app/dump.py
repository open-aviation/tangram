from __future__ import annotations

from datetime import timedelta

from atmlab.network import Network
from pymongo import MongoClient
from traffic.data import ModeS_Decoder


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


class TestClient(ModeS_Decoder):
    @classmethod
    def start_live(cls, host: str, port: int, reference: str):
        decoder = cls.from_address(host, port, reference)
        decoder.launch_te()
        return decoder

    def launch_te(self):
        client = MongoClient()
        self.network = Network()

        self.db = client.get_database(name="adsb")

    def dump_data(self, icao):

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
        except Exception as e:
            flight_data = {}
            callsign1 = None

        callsign = callsign1 if callsign2 is None else callsign2

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

    def clean_aircraft(self, icao):
        self.dump_data(icao)
        super().clean_aircraft(icao)
