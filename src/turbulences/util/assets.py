from flask_assets import Bundle

bundles = {
    "map_js": Bundle("js/map.js"),
    "rotatedmarker_library.js": Bundle(
        "js/leaflet-rotatedmarker/leaflet.rotatedMarker.js"
    ),
}
