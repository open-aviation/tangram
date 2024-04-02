import logging
import os
import resource
from datetime import datetime
from typing import Dict, Any, Optional

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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
_log = logging.getLogger(__name__)


def create_app():
    app = Flask(__name__, static_folder=None)

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

    if decoders_address is None:
        # parse from aggregator traffic.conf
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

    TurbulenceClient.demo = False

    _log.info('turbulence live client, decoders: %s ...', decoders_address)
    app.live_client = TurbulenceClient(decoders=decoders_address)
    if live:
        app.live_client.start_live() app.request_builder = RequestBuilder(app.live_client) 

    app.history_client = TurbulenceClient() 
    if history: 
        app.config["MONGO_URI"] = mongo_uri
        app.mongo = PyMongo(app) 

    app.register_blueprint(history_views.history_bp) 
    app.register_blueprint(base_views.base_bp) 
   
    return app
