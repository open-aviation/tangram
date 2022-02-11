import json

from flask import (
    Blueprint,
    current_app,
    render_template,
    request,
    send_from_directory,
)

import pandas as pd

from .converter import geojson_plane

base_bp = Blueprint("base", __name__)


@base_bp.route("/stop")
def stop_client():
    current_app.client.stop()
    return {}


@base_bp.app_template_filter("format_time")
def format_datetime(value, format="medium"):
    return f"{value:%Y-%m-%d %H:%M:%S}"


@base_bp.route("/turb.geojson")
@base_bp.route("/turb.geojson/<path:und>")
def turbulence(und=None):
    features = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        if und is not None:
            und = int(und) / 1000
            t = pd.Timestamp(und, unit="s", tz="utc")
            pro_data = pro_data.query(f"timestamp<='{str(t)}'")
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
    vsi = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["vertical_rate_inertial"].values(),
    )
    vsb = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["vertical_rate_barometric"].values(),
    )
    cri = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["criterion"].values(),
    )
    thr = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["threshold"].values(),
    )
    data_turb = list(
        {"t": timestamp.timestamp() * 1000, "y": t} for timestamp, t in turb
    )
    data_vsi_std = list(
        {"t": timestamp.timestamp() * 1000, "y": str(t)} for timestamp, t in vsi
    )
    data_vsb_std = list(
        {"t": timestamp.timestamp() * 1000, "y": str(t)} for timestamp, t in vsb
    )
    data_criterion = list(
        {"t": timestamp.timestamp() * 1000, "y": str(t)} for timestamp, t in cri
    )
    data_threshold = list(
        {"t": timestamp.timestamp() * 1000, "y": t} for timestamp, t in thr
    )
    return json.dumps(
        [data_turb, data_vsi_std, data_vsb_std, data_criterion, data_threshold]
    )


@base_bp.route("/planes.geojson")
@base_bp.route("/planes.geojson/<path:und>")
def fetch_planes_Geojson(und=None) -> dict:
    data = current_app.client.traffic
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
        data = data.query(f"timestamp<='{str(t)}'")
    return geojson_plane(data)


@base_bp.route("/sigmet.geojson")
@base_bp.route("/sigmet.geojson/<path:wef>")
@base_bp.route("/sigmet.geojson/<path:wef>,<path:und>")
def fetch_sigmets(wef=None, und=None) -> dict:
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = int(wef) / 1000
        wef = pd.Timestamp(wef, unit="s", tz="utc")
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
    res = current_app.sigmet.sigmets(wef, und, fir="^(L|E)")
    if res is not None:
        res = res.query("validTimeTo>@t")._to_geo()
    else:
        res = {}
    return res


@base_bp.route("/plane.png")
def favicon():
    return send_from_directory("./static", "plane.png")


@base_bp.route("/airep.geojson")
@base_bp.route("/airep.geojson/<path:wef>")
@base_bp.route("/airep.geojson/<path:wef>,<path:und>")
def airep_geojson(wef=None, und=None):
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = int(wef) / 1000
        wef = pd.Timestamp(wef, unit="s", tz="utc")
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
    data = current_app.airep.aireps(wef, und)
    if data is not None:
        result = data.query("expire>@t")._to_geo()
    else:
        result = {}
    return result


@base_bp.route("/cat.geojson")
@base_bp.route("/cat.geojson/<path:wef>,<path:und>")
def clear_air_turbulence(wef=None, und=None):
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = int(wef) / 1000
        # wef = pd.Timestamp(wef, unit="s", tz="utc")
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
    res = (
        current_app.cat.metsafe(
            "metgate:cat_mf_arpege01_europe",
            wef=wef,
            bounds="France métropolitaine",
        )
        .query("endValidity>@t")
        .query("startValidity<=@t")
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


@base_bp.route("/")
def home_page() -> str:
    min_date = request.args.get("min", default=False)
    max_date = request.args.get("max", default=False)
    if (not min_date and not max_date) and not current_app.client.running:
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
    if min_date != False and max_date != False:
        return render_template(
            "index.html",
            airepgeo=(airep, len(airep)),
            sigmet=(sigmet, len(sigmet)),
            history="True",
        )
    return render_template(
        "index.html",
        airepgeo=(airep, len(airep)),
        sigmet=(sigmet, len(sigmet)),
        history="False",
    )
