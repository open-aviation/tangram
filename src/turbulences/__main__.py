import logging
from datetime import datetime

from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.network import Network
from atmlab.weather import Weather
from flask import Flask, url_for
from flask_assets import Environment
from flask_cors import CORS
from flask_pymongo import PyMongo

from turbulences import config

from client.ADSBClient import ADSBClient
from util import assets
from views import base_views, history_views

from waitress import serve


logger = logging.getLogger("waitress")
logger.setLevel(logging.INFO)

app = Flask(__name__)

# # a = app.wsgi_app
# app.config["SERVER_NAME"] = "134.212.235.1:6001"
# app.config["APPLICATION_ROOT"] = "turbulence/stable"
# app.url_map.default_subdomain = "/turbulence/stable"
cors = CORS(app, resources={r"/*": {"origins": "*"}})

asset = Environment(app)
asset.register(assets.bundles)


import os

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


@app.route("/routes")
def list_routes():
    # app.url_map.
    a = url_for("base.home_page")
    return {"route": ["%s" % rule for rule in app.url_map.iter_rules()]}


# def serve_app(app):
#     class ScriptNameStripper(object):
#         def __init__(self, app):
#             self.app = app

#         def __call__(self, environ, start_response):
#             environ["SCRIPT_NAME"] = "turbulence/stable/"
#             return self.app(environ, start_response)

#     app = ScriptNameStripper(app)
#     serve(app, host="0.0.0.0", port=6001, threads=8)


def main():
    app.start_time = datetime.now()

    app.live_client = ADSBClient()
    app.history_client = ADSBClient()

    live_disable = int(config.get("radarcape", "disable", fallback=0))
    if not live_disable:
        client_host = config.get("radarcape", "host", fallback="")
        client_port = int(config.get("radarcape", "port", fallback=10005))
        client_reference = config.get("radarcape", "reference", fallback="")

        app.live_client.start_live(
            host=client_host,
            port=client_port,
            reference=client_reference,
        )

    history_disable = int(config.get("history", "disable", fallback=0))
    if not history_disable:
        app.data_path = config.get("history", "path_data", fallback="")
        app.config["MONGO_URI"] = config.get(
            "history", "database_uri", fallback=""
        )
        app.mongo = PyMongo(app)
    app.register_blueprint(history_views.history_bp)

    app.register_blueprint(base_views.base_bp)

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()
    app.network = Network()
    app_host = config.get("application", "host", fallback="0.0.0.0")
    app_port = int(config.get("application", "port", fallback=5000))
    # serve_app(app)

    app.run(host=app_host, port=app_port)


if __name__ == "__main__":
    main()
