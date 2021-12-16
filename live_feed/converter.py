from functools import lru_cache
import numpy as np
from traffic.core.traffic import Traffic


@lru_cache()
def geojson_plane(data: Traffic) -> dict:
    features = []
    if data is not None:
        for flight in data:
            if flight.shape is not None:
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
                        "properties": {"icao": flight.icao24, "dir": track},
                    }
                    features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson
