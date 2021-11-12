from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment

from .ADSBC_live import ADSBClient
from .util import assets

import configparser
from pathlib import Path

config_dir = Path("/home/mkhalaf/reproduce")
config_file = config_dir / "mongo.conf"
config = configparser.ConfigParser()
config.read(config_file.as_posix())
mongo_username = config.get("mongo", "username", fallback="")
mongo_password = config.get("mongo", "password", fallback="")

def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient(
        host="134.212.189.239", port=10005, reference="LFBO"
    )
    app.client.start()

    app.sigmet = Weather(username="iesta", password="!dtis2050")
    app.sigmet.session.proxies.update(
        {"http": "http://proxy.onera:80", "https": "https://proxy.onera:80"}
    )
    from . import views

    # pro_data = app.client.pro_data
    # print(pro_data)
    # app.client.stop()
    app.register_blueprint(views.bp)
    asset = Environment(app)
    asset.register(assets.bundles)
    return app
