import logging

import click
from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment
from waitress import serve

from turbulences import config

from client.ADSBClient import ADSBClient
from util import assets

logger = logging.getLogger("waitress")
logger.setLevel(logging.INFO)

app = Flask(__name__, instance_relative_config=True)


@click.command()
@click.argument("live")
def main(live: str):
    app.client = ADSBClient()
    if live.strip() == "live":
        print(1)
        host = config.get("radarcape", "host", fallback="")
        port = int(config.get("radarcape", "port", fallback=""))
        reference = config.get("radarcape", "reference", fallback="")
        app.client.start_live(host=host, port=port, reference=reference)
    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()

    from views import base_views, live_views, history_views

    app.register_blueprint(base_views.base_bp)
    app.register_blueprint(live_views.live_bp)
    app.register_blueprint(history_views.history_bp)

    asset = Environment(app)
    asset.register(assets.bundles)

    serve(app, host="0.0.0.0", port=5000, threads=8)


if __name__ == "__main__":
    main()
