import configparser
from pathlib import Path

from appdirs import user_config_dir
from atmlab.airep import AIREP
from atmlab.weather import Weather
from atmlab.metsafe import Metsafe
from flask import Flask
from flask_assets import Environment

from .ADSBClient import ADSBClient
from .util import assets

config_dir = Path(user_config_dir("atmlab"))
config_file = config_dir / "atmlab.conf"
config = configparser.ConfigParser()
config.read(config_file.as_posix())


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient()

    host = config.get("radarcape", "host", fallback="")
    port = int(config.get("radarcape", "port", fallback=""))
    reference = config.get("radarcape", "reference", fallback="")
    app.client.start_live(host=host, port=port, reference=reference)

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()

    from . import views

    app.register_blueprint(views.bp)
    asset = Environment(app)
    asset.register(assets.bundles)
    return app
