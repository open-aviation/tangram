from typing import Any, Dict, List, Optional

from traffic.core import Traffic

import numpy as np


def geojson_flight(stv: list) -> Optional[Dict[str, Any]]:
    latitude = stv["latitude"]
    longitude = stv["longitude"]
    if not (np.isnan(latitude) and np.isnan(longitude)):
        track = stv["track"]
        typecode = stv["typecode"]
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
                "icao": stv["icao24"],
                "callsign": stv["callsign"],
                "typecode": None if str(typecode) == "nan" else typecode,
                "dir": 0 if np.isnan(track) else track,
            },
        }
        return x
    return None


def geojson_traffic(traffic: Traffic) -> Dict[str, Any]:
    features: List[Optional[Dict[str, Any]]] = []
    if traffic is not None:
        fields = ["icao24", "callsign", "track", "latitude", "longitude", "typecode"]
        state_vectors = (traffic.data
            .groupby("icao24", as_index=False)[fields]
            .ffill()
            .groupby("icao24", as_index=False)
            .last()
        ).to_dict(orient="records")
        f = map(geojson_flight, state_vectors)
        features = list(t for t in f if t is not None)
    return {
        "count": len(features),
        "geojson": {"type": "FeatureCollection", "features": features},
    }
    # geojson = {
    #     "type": "FeatureCollection",
    #     "features": features,
    # }
    # encapsulated_geojson = {
    #     "count": len(geojson["features"]),
    #     "geojson": geojson,
    # }
    # return encapsulated_geojson


def geojson_turbulence(pro_data: Optional[Traffic]) -> Dict[str, Any]:
    features = []
    if pro_data is not None:
        turb: Optional[Traffic] = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                icao24 = flight.icao24
                callsign = flight.callsign
                typecode = flight.data.typecode.iloc[0]
                if flight.shape is not None:
                    for segment in flight.split("1T"):
                        if segment is not None:
                            x = {"type": "LineString", "coordinates": []}
                            t = []
                            for i in segment.simplify(1e3).coords4d():
                                x["coordinates"].append(
                                    [
                                        i["longitude"],
                                        i["latitude"],
                                        i["altitude"],
                                    ]
                                )
                                t.append(i["timestamp"])
                            if len(x["coordinates"]) > 0:
                                intensity = segment.data.intensity_turb.iloc[0]
                                x.update(
                                    {
                                        "properties": {
                                            "icao": icao24,
                                            "callsign": callsign,
                                            "typecode": None
                                            if str(typecode) == "nan"
                                            else typecode,
                                            "start": segment.start.timestamp(),
                                            "time": t,
                                            "validity": segment.data[
                                                "expire_turb"
                                            ].iloc[0],
                                            "intensity": intensity,
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
