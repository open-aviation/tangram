import logging
import os
from datetime import datetime

import click
from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.network import Network
from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment
from flask_cors import CORS
from flask_pymongo import PyMongo
from traffic import config
from waitress import serve
from werkzeug.middleware.proxy_fix import ProxyFix

from . import config_turb
from .client.turbulence import TurbulenceClient
from .util import assets
from .views import base_views, history_views
from .views.requests import RequestBuilder

app = Flask(__name__, static_folder=None)
_log = logging.getLogger("waitress")
_log.setLevel(logging.INFO)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

cors = CORS(app, resources={r"/*": {"origins": "*"}})
asset = Environment(app)
asset.register(assets.bundles)

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


app_host = config_turb.get("turbulence", "host", fallback="0.0.0.0")
app_port = int(config_turb.get("turbulence", "port", fallback=5000))
live = int(config_turb.get("turbulence", "live", fallback=1))
history = int(config_turb.get("turbulence", "history", fallback=1))
data_path = config_turb.get("turbulence", "path_data", fallback="")
mongo_uri = config_turb.get("turbulence", "database_uri", fallback="")


@click.command()
@click.option("--source", default=None)
@click.option("--address", "decoders_address", default=None)
@click.option("--host", "app_host", default=app_host)
@click.option("--port", "app_port", default=app_port)
@click.option("--live", default=live)
@click.option("--history", default=history)
@click.option("--data_path", default=data_path)
@click.option("--mongo_uri", default=mongo_uri)
def main(
    app_host,
    app_port,
    live,
    history,
    data_path,
    mongo_uri,
    source,
    decoders_address,
):
    if decoders_address is None:
        decoders_address = {
            "aggregator": str(
                "tcp://"
                + config.get("aggregator", "host", fallback="127.0.0.1")
                + ":"
                + config.get("aggregator", "port", fallback="5054")
            )
        }

    if source is not None:
        decoders_address = {
            source: str(
                "tcp://"
                + config.get("decoders." + source, "serve_host")
                + ":"
                + config.get("decoders." + source, "serve_port")
            )
        }
    app.start_time = datetime.now()
    app.live_client = TurbulenceClient(decoders=decoders_address)
    app.history_client = TurbulenceClient()
    if live:
        app.live_client.start_live()
        app.request_builder = RequestBuilder(app.live_client)
    if history:
        app.data_path = data_path
        app.config["MONGO_URI"] = mongo_uri
        app.mongo = PyMongo(app)

    app.register_blueprint(history_views.history_bp)
    app.register_blueprint(base_views.base_bp)

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()
    app.network = Network()

    serve(app=app, host=app_host, port=app_port, threads=20)


if __name__ == "__main__":
    main()
