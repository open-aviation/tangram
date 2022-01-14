from flask_assets import Bundle

bundles = {
    "map_live": Bundle("js/map_live.js"),
    "map_history": Bundle("js/map_history.js"),
    "rotatedmarker_library.js": Bundle(
        "js/leaflet-rotatedmarker/leaflet.rotatedMarker.js"
    ),
    "map_functions": Bundle("js/map_functions.js"),
    "chart_js": Bundle("js/graph.js"),
}
