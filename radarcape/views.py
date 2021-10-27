import time
import numpy as np
from traffic.core.flight import Position
from .converter import geojson_trajectoire, write_Json_to_Geojson
from flask import Blueprint, current_app, jsonify, render_template
from flask.wrappers import Response

bp = Blueprint("liste_vols", __name__)


def calcul_list_vols() -> dict:
    resultats: dict[str, Position] = dict()
    for flight in current_app.client.pro_data:
        if flight.shape is not None:
            p = flight.at(flight.start)
            if not (np.isnan(p.latitude_mean) and np.isnan(p.longitude_mean)):
                resultats[flight.icao24] = (
                    p.latitude_mean,
                    p.longitude_mean,
                )
    return resultats


@bp.route("/radarcape/", methods=["GET"])
def list_vols() -> Response:
    resultats = calcul_list_vols()
    return jsonify(resultats)


@bp.route("/radarcape/map", methods=["GET"])
def create_map() -> str:
    return render_template("map.html")


@bp.route("/radarcape/trajectory", methods=["GET"])
def traj() -> str:
    return render_template("maptraj.html")


@bp.route("/radarcape/traj.geojson", methods=["GET"])
def draw_trajectoire():
    liste = []
    for flight in current_app.client.pro_data.query("turbulence"):
        if flight.shape is not None:
            liste.append(flight)
    resultats = geojson_trajectoire(liste)
    return resultats


@bp.route("/radarcape/results.geojson", methods=["GET"])
def fetch_results_Geojson() -> dict:
    res = calcul_list_vols()
    return write_Json_to_Geojson(res)
