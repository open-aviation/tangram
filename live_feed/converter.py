import numpy as np
from traffic.core.flight import Flight
from traffic.core.traffic import Traffic


def geojson_plane(data: Traffic) -> dict:
    features = []
    if data is not None:
        for flight in data:
            if flight.shape is not None:
                p = flight.at(flight.stop)
                if not (np.isnan(p.latitude) and np.isnan(p.longitude)):
                    x = {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [
                                p.longitude,
                                p.latitude,
                            ],
                        },
                        "properties": {"icao": flight.icao24, "dir": p.track},
                    }
                    features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson


def geojson_trajectoire(data: list[Flight]) -> dict:
    features = []
    for d in data:
        for segment in d.split("1T"):
            if segment.shape is not None:
                x = segment.geojson()
                x.update({"properties": {"icao": d.icao24}})
                features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson


def geojson_airep(data: dict) -> dict:
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": d["location"]["type"],
                    "coordinates": [
                        d["location"]["coordinates"][0],
                        d["location"]["coordinates"][1],
                    ],
                },
                "properties": d,
            }
            for d in data
        ],
    }
    return geojson
