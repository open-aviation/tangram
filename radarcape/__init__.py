from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment
from traffic.data import session

from .ADSBClient import ADSBClient
from .util import assets

import configparser
from pathlib import Path

# import logging
# log = logging.getLogger('werkzeug')
# log.setLevel(logging.ERROR)

config_dir = Path("/home/mkhalaf/api_radarcape")
config_file = config_dir / "config.conf"
config = configparser.ConfigParser()
config.read(config_file.as_posix())
mongo_username = config.get("mongo", "username", fallback="")
mongo_password = config.get("mongo", "password", fallback="")


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient()
    # app.client.start_live(host="134.212.189.239", port=10005, reference="LFBO")
    app.client.start_from_file(file="2021-11-08_traffic.pkl", reference="LFBO")
    app.sigmet = Weather(username=mongo_username, password=mongo_password)
    app.sigmet.session.proxies.update(
        {
            "http": config.get("proxy", "proxy_http", fallback=""),
            "https": config.get("proxy", "proxy_https", fallback=""),
        }
    )
    c = session.post(
        "https://api.airep.info/login",
        data={
            "username": config.get("airep", "username", fallback=""),
            "password": config.get("airep", "password", fallback=""),
        },
    )
    c.raise_for_status()
    app.airep_token = c.text

    from . import views

    # pro_data = app.client.pro_data
    # print(pro_data)
    # app.client.stop()
    app.register_blueprint(views.bp)
    asset = Environment(app)
    asset.register(assets.bundles)
    return app
