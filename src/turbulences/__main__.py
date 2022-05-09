import logging
import os
import threading
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
from waitress import serve
from werkzeug.middleware.proxy_fix import ProxyFix
from paste.translogger import TransLogger

from turbulences import config_turb

from .client.ADSBClient import ADSBClient
from .util import assets
from .views import base_views, history_views

app = Flask(__name__, static_folder=None)
# logger = logging.getLogger()
# logger.setLevel(logging.INFO)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

cors = CORS(app, resources={r"/*": {"origins": "*"}})
asset = Environment(app)
asset.register(assets.bundles)

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


app_host = config_turb.get("application", "host", fallback="0.0.0.0")
app_port = int(config_turb.get("application", "port", fallback=5000))
live_disable = int(config_turb.get("decoders", "disable", fallback=0))
history_disable = int(config_turb.get("history", "disable", fallback=0))
data_path = config_turb.get("history", "path_data", fallback="")
mongo_uri = config_turb.get("history", "database_uri", fallback="")


@click.command()
@click.option("--source", default='toulouse')
@click.option("--address", "decoder_address", default=None)
@click.option("--host", "app_host", default=app_host)
@click.option("--port", "app_port", default=app_port)
@click.option("--live_disable", default=live_disable)
@click.option("--history_disable", default=history_disable)
@click.option("--data_path", default=data_path)
@click.option("--mongo_uri", default=mongo_uri)
def main(app_host, app_port, live_disable, history_disable,
         data_path, mongo_uri, source, decoder_address):
    if decoder_address is None:
        decoder_address = config_turb.get(
            'decoders',
            source,
            fallback=""
        )
    app.start_time = datetime.now()
    app.live_client = ADSBClient(decoder_address=decoder_address)
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
    flask_thread = threading.Thread(
        target=serve,
        daemon=True,
        kwargs=dict(
            app=TransLogger(app, setup_console_handler=False),
            host=app_host,
            port=app_port,
            threads=8
        ),
    )
    flask_thread.start()
    flask_thread.join()
    # app.run(host=app_host, port=app_port)


if __name__ == "__main__":
    main()
