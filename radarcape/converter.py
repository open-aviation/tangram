from traffic.core.flight import Flight


def write_Json_to_Geojson(data: dict) -> dict:

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        data[d][1],
                        data[d][0],
                    ],
                },
                "properties": d,
            }
            for d in data
        ],
    }
    return geojson


def geojson_trajectoire(data: list[Flight]) -> dict:
    features = []
    for d in data:
        for segment in d.split("1T"):
            x = segment.geojson()
            x.update({"properties": d.icao24})
            features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson
