# from .. import app
from flask_assets import Bundle

bundles = {
    "admin_js": Bundle("js/map.js"),
    # "admin_css": Bundle(
    #     "css/lib/reset.css",
    #     "css/common.css",
    #     "css/admin.css",
    #     output="gen/admin.css",
    # ),
}
