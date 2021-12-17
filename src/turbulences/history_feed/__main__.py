from atmlab.airep import AIREP
from atmlab.metsafe import Metsafe
from atmlab.weather import Weather
from flask import Flask
from flask_assets import Environment

from turbulences.history_feed import config
from .client.ADSBClient import ADSBClient
from .util import assets
from waitress import serve

app = Flask(__name__, instance_relative_config=True)


def main():
    app.client = ADSBClient()

    app.sigmet = Weather()
    app.airep = AIREP()
    app.cat = Metsafe()

    from .views import views

    app.register_blueprint(views.bp)
    asset = Environment(app)
    asset.register(assets.bundles)

    serve(app, host="0.0.0.0", port=5000, threads=6)


if __name__ == "__main__":
    main()
