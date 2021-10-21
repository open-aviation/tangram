from flask import Flask
from .ADSBC_live import ADSBClient, main


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient(host="134.212.189.239",
                            port=10005, rawtype="beast")
    main(app.client)
    from . import liste_vols
    app.register_blueprint(liste_vols.bp)
    return app
