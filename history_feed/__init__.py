import configparser

from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment
from traffic.data import session

from .ADSBClient import ADSBClient
from .util import assets

config_file = "./config.conf"
config = configparser.ConfigParser()
config.read(config_file)
mongo_username = config.get("mongo", "username", fallback="")
mongo_password = config.get("mongo", "password", fallback="")


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient()
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

    app.register_blueprint(views.bp)
    asset = Environment(app)
    asset.register(assets.bundles)
    return app