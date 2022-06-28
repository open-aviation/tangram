from threading import Timer

from traffic.core import Flight, Traffic

import numpy as np
from turbulence.client.ADSBClient import ADSBClient


def geojson_flight(flight: Flight) -> dict:
    latitude = flight.data.latitude.iloc[-1]
    longitude = flight.data.longitude.iloc[-1]
    if not (np.isnan(latitude) and np.isnan(longitude)):
        track = flight.data.track.iloc[-1]
        typecode = flight.data.typecode.iloc[-1]
        x = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    longitude,
                    latitude,
                ],
            },
            "properties": {
                "icao": flight.icao24,
                "callsign": flight.callsign,
                "typecode": None if str(typecode) == 'nan' else typecode,
                "dir": 0 if np.isnan(track) else track,
            },
        }
        return x
    return None


def geojson_traffic(traffic: Traffic) -> dict:
    features = []
    if traffic is not None:
        # with ProcessPoolExecutor(max_workers=4) as executor:
        features = map(geojson_flight, traffic)
        features = list(filter(lambda t: t is not None, features))
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    encapsulated_geojson = {
        "count": len(geojson["features"]),
        "geojson": geojson,
    }
    return encapsulated_geojson


def geojson_turbulence(pro_data: Traffic) -> dict:
    features = []
    if pro_data is not None:
        turb: Traffic = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    for segment in flight.split("1T"):
                        if segment is not None:
                            x = segment.geojson()
                            if x is not None:
                                x.update(
                                    {
                                        "properties": {
                                            "icao": flight.icao24,
                                            "callsign": flight.callsign,
                                            "typecode": flight.typecode,
                                            "start": segment.start.timestamp(),
                                            "validity": segment.data[
                                                "expire_turb"
                                            ].iloc[0],
                                        }
                                    }
                                )
                                features.append(x)

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    encapsulated_geojson = {
        "count": len(geojson["features"]),
        "geojson": geojson,
    }
    return encapsulated_geojson


class RepeatTimer(Timer):
    def run(self):
        while not self.finished.wait(self.interval):
            self.function(*self.args, **self.kwargs)


class RequestBuilder():
    def __init__(self, client: ADSBClient) -> None:
        self.client: ADSBClient = client
        self.planes_position: dict = {}
        self.turb_result: dict = {}
        self.planethread: RepeatTimer = RepeatTimer(5, self.plane_request)
        self.planethread.start()
        self.turbthread: RepeatTimer = RepeatTimer(5, self.turb_request)
        self.turbthread.start()

    def plane_request(self):
        self.planes_position = geojson_traffic(self.client.traffic)

    def turb_request(self):
        self.turb_result = geojson_turbulence(self.client.pro_data)
