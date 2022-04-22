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
from werkzeug.middleware.proxy_fix import ProxyFix

from turbulences import config

from .client.ADSBClient import ADSBClient
from .util import assets
from .views import base_views, history_views

app = Flask(__name__)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

cors = CORS(app, resources={r"/*": {"origins": "*"}})
asset = Environment(app)
asset.register(assets.bundles)

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


app_host = config.get("application", "host", fallback="0.0.0.0")
app_port = int(config.get("application", "port", fallback=5000))
live_disable = int(config.get("radarcape", "disable", fallback=0))
client_host = config.get("radarcape", "host", fallback="")
client_port = int(config.get("radarcape", "port", fallback=10005))
client_reference = config.get("radarcape", "reference", fallback="")
history_disable = int(config.get("history", "disable", fallback=0))
data_path = config.get("history", "path_data", fallback="")
mongo_uri = config.get("history", "database_uri", fallback="")


@click.command()
@click.option("--app_host", default=app_host)
@click.option("--app_port", default=app_port)
@click.option("--live_disable", default=live_disable)
@click.option("--client_host", default=client_host)
@click.option("--client_port", default=client_port)
@click.option("--client_reference", default=client_reference)
@click.option("--history_disable", default=history_disable)
@click.option("--data_path", default=data_path)
@click.option("--mongo_uri", default=mongo_uri)
def main(app_host, app_port, live_disable, client_host,
         client_port, client_reference, history_disable,
         data_path, mongo_uri):
    app.start_time = datetime.now()
    app.live_client = ADSBClient()
    app.history_client = ADSBClient()
    if not live_disable:
        app.live_client.start_live()
    if not history_disable:
        app.data_path = data_path
        app.config["MONGO_URI"] = mongo_uri
        app.mongo = PyMongo(app)

    app.register_blueprint(history_views.history_bp)
    app.register_blueprint(base_views.base_bp)

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()
    app.network = Network()
    # serve(app, host=app_host, port=app_port)
    app.run(host=app_host, port=app_port)


if __name__ == "__main__":
    main()
