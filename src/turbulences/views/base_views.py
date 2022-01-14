import json

from flask import Blueprint, current_app, render_template, send_from_directory

import pandas as pd

from .converter import geojson_plane

base_bp = Blueprint("base", __name__)


@base_bp.app_template_filter("format_time")
def format_datetime(value, format="medium"):
    return f"{value:%Y-%m-%d %H:%M:%S}"


@base_bp.route("/turb.geojson")
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


@base_bp.route("/chart.data/<path:icao>")
def chart_data(icao):
    pro_data = current_app.client.pro_data
    resultats = pro_data[icao].data
    resultats_turb = resultats.query("turbulence")
    turb = zip(
        resultats_turb.to_dict()["timestamp"].values(),
        resultats_turb.to_dict()["turbulence"].values(),
    )
    vsi_std = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["vertical_rate_inertial_std"].values(),
    )
    vsb_std = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["vertical_rate_barometric_std"].values(),
    )
    data_turb = list(
        {"t": timestamp.timestamp() * 1000, "y": t} for timestamp, t in turb
    )
    data_vsi_std = list(
        {"t": timestamp.timestamp() * 1000, "y": t} for timestamp, t in vsi_std
    )
    data_vsb_std = list(
        {"t": timestamp.timestamp() * 1000, "y": t} for timestamp, t in vsb_std
    )
    return json.dumps([data_turb, data_vsi_std, data_vsb_std])


@base_bp.route("/planes.geojson")
def fetch_planes_Geojson() -> dict:
    data = current_app.client.traffic
    return geojson_plane(data)


@base_bp.route("/sigmet.geojson")
@base_bp.route("/sigmet.geojson/<path:wef>")
@base_bp.route("/sigmet.geojson/<path:wef>,<path:und>")
def fetch_sigmets(wef=None, und=pd.Timestamp("now", tz="utc")) -> dict:
    if wef is not None:
        wef = pd.to_datetime(int(wef), unit="ms")
    res = current_app.sigmet.sigmets(wef, fir="^(L|E)").query(
        "validTimeTo>@und"
    )
    res = res._to_geo()
    return res


@base_bp.route("/plane.png")
def favicon():
    return send_from_directory("./static", "plane.png")


@base_bp.route("/airep.geojson")
@base_bp.route("/airep.geojson/<path:wef>,<path:und>")
def airep_geojson(wef=None, und=pd.Timestamp("now", tz="utc")):
    data = current_app.airep.aireps(wef)
    if data is not None:
        result = data.query("expire>@und")._to_geo()
    else:
        result = {}
    return result


@base_bp.route("/cat.geojson")
@base_bp.route("/cat.geojson/<path:wef>,<path:und>")
def clear_air_turbulence(wef=None, und=pd.Timestamp("now", tz="utc")):
    res = (
        current_app.cat.metsafe(
            "metgate:cat_mf_arpege01_europe",
            wef=wef,
            bounds="France métropolitaine",
        )
        .query("endValidity>@und")
        .query("startValidity<=@und")
    )
    return res._to_geo()


@base_bp.route("/fonts/<path:filename>")
def serve_static(filename):
    return send_from_directory("fonts/", filename)


def launch_client():
    current_app.client.start_live(
        host=current_app.client_host,
        port=current_app.client_port,
        reference=current_app.client_reference,
    )


@base_bp.route("/", defaults={"history": False})
@base_bp.route("/<history>")
def home_page(history) -> str:
    if not history and not current_app.client.running:
        launch_client()
    airep = airep_geojson()
    sigmet = fetch_sigmets()
    if len(airep) > 0:
        airep = [x["properties"] for x in airep["features"]]
    else:
        airep = []
    if sigmet is not None:
        sigmet = [x["properties"] for x in sigmet["features"]]
    else:
        sigmet = []

    return render_template(
        "index.html",
        airepgeo=(airep, len(airep)),
        sigmet=(sigmet, len(sigmet)),
        history=history,
    )
