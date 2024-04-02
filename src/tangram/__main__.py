import logging
import os
import resource
from datetime import datetime

import click

# from atmlab.airep import AIREP
# from atmlab.metsafe import Metsafe
# from atmlab.network import Network
# from atmlab.weather import Weather

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
# _log = logging.getLogger("waitress")
# _log.setLevel(logging.INFO)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
_log = logging.getLogger(__name__)


app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

cors = CORS(app, resources={r"/*": {"origins": "*"}})
asset = Environment(app)
asset.register(assets.bundles)

SECRET_KEY = os.urandom(32)
app.config["SECRET_KEY"] = SECRET_KEY


app_host = config_turb.get("tangram", "host", fallback="0.0.0.0")
app_port = int(config_turb.get("tangram", "port", fallback=5050))
live = int(config_turb.get("tangram", "live", fallback=1))
history = int(config_turb.get("tangram", "history", fallback=0))  # TBD disable by default
data_path = config_turb.get("tangram", "path_data", fallback="")
mongo_uri = config_turb.get("tangram", "database_uri", fallback="")


def memory_limit() -> None:
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    resource.setrlimit(resource.RLIMIT_AS, (get_memory() * 1024 // 2, hard))


def get_memory() -> int:
    with open("/proc/meminfo", "r") as mem:
        free_memory = 0
        for i in mem:
            sline = i.split()
            if str(sline[0]) in ("MemFree:", "Buffers:", "Cached:"):
                free_memory += int(sline[1])
    return free_memory


@click.command()
@click.option("--source", default=None)
@click.option("--address", "decoders_address", default=None)
@click.option("--host", "app_host", default=app_host)
@click.option("--port", "app_port", default=app_port)
@click.option("--live", default=live)
@click.option("--history", default=history)
@click.option("--data_path", default=data_path)
@click.option("--mongo_uri", default=mongo_uri)
@click.option("--demo", is_flag=True, default=False)
def main(app_host, app_port, live, history, data_path, mongo_uri, source, decoders_address, demo) -> None:
    memory_limit()
    # with memray.Tracker("output_file.bin",):
    #     print("Allocations will be tracked until the with block ends")

    if decoders_address is None:
        # directly from local decoders
        # serve_host, serve_port = '127.0.0.1', 5051

        # from aggregator defined in traffic.config
        serve_host = config.get("aggregator", "serve_host", fallback='omdb.lr.tudelft.nl')
        serve_port = config.get("aggregator", "serve_port", fallback=9142)
        decoders_address = {
            'aggregator': f"tcp://{serve_host}:{serve_port}",
        }

    if source is not None:
        host, port = config.get(f"decoders.{source}", "serve_host"), config.get(f"decoders.{source}", "serve_port")
        decoders_address = {
            source: f"tcp://{host}:{port}"
        }

    app.start_time = datetime.now()

    TurbulenceClient.demo = demo
    _log.info('turbulence live client, decoders: %s ...', decoders_address)
    app.live_client = TurbulenceClient(decoders=decoders_address)
    if live:
        app.live_client.start_live()
        app.request_builder = RequestBuilder(app.live_client)

    # app.history_client = TurbulenceClient()
    if history:
        app.config["MONGO_URI"] = mongo_uri
        app.mongo = PyMongo(app)

    app.register_blueprint(history_views.history_bp)
    app.register_blueprint(base_views.base_bp)

    # app.sigmet = Weather()
    # app.airep = AIREP()
    # app.cat = Metsafe()
    # app.network = Network()

    serve(app=app, host=app_host, port=app_port, threads=5)


if __name__ == "__main__":
    main()
