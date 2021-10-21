import time
from .converter import write_Json_to_Geojson
from flask import Blueprint, current_app, jsonify, render_template
from flask.wrappers import Response

from .ADSBC_live import nb_vol

bp = Blueprint("liste_vols", __name__)


def calcul_list_vols() -> dict:
    return nb_vol(current_app.client)


@bp.route("/radarcape/", methods=["GET"])
def list_vols() -> Response:
    xa = time.time()
    resultats = calcul_list_vols()
    print(time.time() - xa)
    return jsonify(resultats)


@bp.route("/radarcape/map", methods=["GET"])
def create_map() -> str:
    return render_template("map.html")


@bp.route("/radarcape/results.geojson", methods=["GET"])
def fetch_results_Geojson() -> dict:
    res = calcul_list_vols()
    return write_Json_to_Geojson(res)
