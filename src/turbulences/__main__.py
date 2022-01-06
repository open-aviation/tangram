import logging

from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment

from turbulences import config

from .client.ADSBClient import ADSBClient
from .util import assets
from .views import base_views, history_views

# from waitress import serve


logger = logging.getLogger("waitress")
logger.setLevel(logging.INFO)

app = Flask(__name__, instance_relative_config=True)


def main():
    app.client = ADSBClient()
    app.client_host = config.get("radarcape", "host", fallback="")
    app.client_port = int(config.get("radarcape", "port", fallback=""))
    app.client_reference = config.get("radarcape", "reference", fallback="")
    app.data_path = config.get("history", "path_data", fallback="")

    app.register_blueprint(history_views.history_bp)
    app.register_blueprint(base_views.base_bp)

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()

    asset = Environment(app)
    asset.register(assets.bundles)
    app.run(host="0.0.0.0", port=5000)
    # serve(app, host="0.0.0.0", port=5000, threads=8)


if __name__ == "__main__":
    main()
