import os

import numpy as np
import pandas as pd
from flask import (Blueprint, app, current_app, jsonify, render_template,
                   send_from_directory)
from flask.wrappers import Response
from traffic.core.flight import Position

from .converter import geojson_trajectoire, write_Json_to_Geojson

bp = Blueprint("liste_vols", __name__)


def calcul_list_vols() -> dict:
    resultats: dict[str, Position] = dict()
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        for flight in pro_data:
            if flight.shape is not None:
                p = flight.at(flight.stop)
                if not (np.isnan(p.latitude) and np.isnan(p.longitude)):
                    resultats[flight.icao24] = [p.latitude, p.longitude, p.track]
    return resultats


@bp.route("/radarcape/", methods=["GET"])
def list_vols() -> Response:
    resultats = calcul_list_vols()
    return jsonify(resultats)


@bp.route("/radarcape/map", methods=["GET"])
def create_map() -> str:
    return render_template("map.html")


@bp.route("/radarcape/turb.geojson", methods=["GET"])
def draw_trajectoire():
    liste = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        turb = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    liste.append(flight)
    resultats = geojson_trajectoire(liste)
    return resultats


@bp.route("/radarcape/results.geojson", methods=["GET"])
def fetch_results_Geojson() -> dict:
    res = calcul_list_vols()
    return write_Json_to_Geojson(res)


@bp.route("/radarcape/sigmet.geojson", methods=["GET"])
def fetch_sigmets() -> dict:
    utc_now = pd.Timestamp("now", tz="utc")
    res = current_app.sigmet.sigmets(
        fir="^(L|E)").query("validTimeTo>@utc_now")
    res = res._to_geo()
    return res


@bp.route('/radarcape/plane.png')
def favicon():
    return send_from_directory('./static',
                               'plane.png')
