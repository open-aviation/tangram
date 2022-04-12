import logging
import os
from datetime import datetime

from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.network import Network
from atmlab.weather import Weather
from flask import Flask, request
from flask_assets import Environment
from flask_cors import CORS
from flask_pymongo import PyMongo
from werkzeug.middleware.proxy_fix import ProxyFix

from turbulences import config

from .client.ADSBClient import ADSBClient
from .util import assets
from .views import base_views, history_views

app = Flask(__name__, static_folder=None)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

cors = CORS(app, resources={r"/*": {"origins": "*"}})
asset = Environment(app)
asset.register(assets.bundles)

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


# @app.before_request
# def before_request():
#     print(request.headers.get("X-Forwarded-Prefix"))


@app.route("/routes")
def list_routes():
    # app.url_map.
    return {"route": ["%s" % rule for rule in app.url_map.iter_rules()]}


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
    # serve(app, host=app_host, port=app_port)

    app.run(host=app_host, port=app_port)


if __name__ == "__main__":
    main()
