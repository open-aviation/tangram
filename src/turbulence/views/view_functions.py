from concurrent.futures import ProcessPoolExecutor

from traffic.core import Flight, Traffic

import numpy as np


def geojson_flight(flight: Flight) -> dict:
    data = flight.data
    latitude = data.latitude.iloc[-1]
    longitude = data.longitude.iloc[-1]
    track = data.track.iloc[-1]
    if not (np.isnan(latitude) and np.isnan(longitude)):
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
                "typecode": flight.typecode,
                "dir": 0 if np.isnan(track) else track,
            },
        }
        return x
    return None


def geojson_traffic(traffic: Traffic) -> dict:
    features = []
    if traffic is not None:
        with ProcessPoolExecutor(max_workers=4) as executor:
            features = executor.map(geojson_flight, traffic)
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


def geojson_traj(flight: Flight) -> dict:
    features = []
    if flight is not None:
        cor = flight.coords4d()
        x = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": list(cor),
                },
                "properties": {
                    "icao": flight.icao24,
                    "callsign": flight.callsign,
                    "typecode": flight.typecode
                },
            }
        features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson