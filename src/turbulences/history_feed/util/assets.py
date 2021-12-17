# from .. import app
from flask_assets import Bundle

bundles = {
    "map_js": Bundle("js/map.js"),
    "rotatedmarker_library.js": Bundle(
        "js/leaflet-rotatedmarker/leaflet.rotatedMarker.js"
    )
    # "admin_css": Bundle(
    #     "css/lib/reset.css",
    #     "css/common.css",
    #     "css/admin.css",
    #     output="gen/admin.css",
    # ),
}
