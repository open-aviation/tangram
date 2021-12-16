import pandas as pd
from flask import Blueprint, current_app, render_template, send_from_directory

from .converter import geojson_plane

bp = Blueprint("radarcape", __name__)


@bp.route("/radarcape/map", methods=["GET"])
def create_map() -> str:
    return render_template("map.html")


@bp.route("/radarcape/turb.geojson", methods=["GET"])
def turbulence():
    features = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        turb = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    for segment in flight.split("1T"):
                        x = segment.geojson()
                        x.update({"properties": {"icao": flight.icao24}})
                        features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson


@bp.route("/radarcape/planes.geojson", methods=["GET"])
def fetch_planes_Geojson() -> dict:
    data = current_app.client.traffic
    return geojson_plane(data)


@bp.route("/radarcape/sigmet.geojson", methods=["GET"])
def fetch_sigmets() -> dict:
    utc_now = pd.Timestamp("now", tz="utc")
    res = current_app.sigmet.sigmets(fir="^(L|E)").query("validTimeTo>@utc_now")
    res = res._to_geo()
    return res


@bp.route("/radarcape/plane.png")
def favicon():
    return send_from_directory("./static", "plane.png")


@bp.route("/radarcape/airep.geojson")
def airep_geojson():
    utc_now = pd.Timestamp("now", tz="utc")
    data = current_app.airep.aireps()
    if data is not None:
        result = data.query("expire>@utc_now")._to_geo()
    else:
        result = {}
    return result


@bp.route("/radarcape/cat.geojson")
def clear_air_turbulence():
    utc_now = pd.Timestamp("now", tz="utc")
    res = current_app.cat.metsafe(
        "metgate:cat_mf_arpege01_europe",
        bounds="France métropolitaine",
    ).query("endValidity>@utc_now")
    return res._to_geo()
