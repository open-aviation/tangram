from flask import Flask
from .ADSBC_live import ADSBClient


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.client = ADSBClient(
        host="134.212.189.239", port=10005, reference="LFBO"
    )
    app.client.start()
    from . import views

    # pro_data = app.client.pro_data
    # print(pro_data)
    # app.client.stop()
    app.register_blueprint(views.bp)
    return app
