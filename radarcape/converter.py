def write_Json_to_Geojson(data: dict) -> dict:

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        data[d][0]["ps"]["lon"],
                        data[d][0]["ps"]["lat"],
                    ],
                },
                "properties": d,
            }
            for d in data
        ],
    }
    return geojson
