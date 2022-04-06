from datetime import datetime
import json
from flask_cors import CORS
from flask import (
    Blueprint,
    current_app,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from traffic.core import Traffic

import pandas as pd
from turbulences.views.forms import InfoForm

from .view_functions import geojson_plane

base_bp = Blueprint("base", __name__)
CORS(base_bp)


@base_bp.route("/stop")
def stop_client():
    current_app.live_client.stop()
    return {}


@base_bp.route("/flight/<path:icao>")
def get_info_flight(icao):
    try:
        data = current_app.network.icao24(icao)
    except Exception:
        data = {}
    return data


@base_bp.app_template_filter("format_time")
def format_datetime(value, format="medium"):
    return f"{value:%Y-%m-%d %H:%M:%S}"


@base_bp.route("/turb.geojson")
@base_bp.route("/turb.geojson/<path:und>")
def turbulence(und=None):
    client = current_app.live_client
    history = request.args.get("history", default=False)
    if history:
        client = current_app.history_client
    features = []
    pro_data = client.pro_data
    if pro_data is not None:
        if und is not None:
            und = int(und) / 1000
            t = pd.Timestamp(und, unit="s", tz="utc")
            pro_data = pro_data.query(f"timestamp<='{str(t)}'")
        turb: Traffic = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    for segment in flight.split("1T"):
                        if segment is not None:
                            try:
                                x = segment.geojson()
                                x.update(
                                    {
                                        "properties": {
                                            "icao": flight.icao24,
                                            "time": segment.start.timestamp(),
                                        }
                                    }
                                )
                                features.append(x)
                            except Exception as e:
                                print(e)
                                print(flight.icao24)

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson


@base_bp.route("/chart.data/<path:icao>")
def chart_data(icao):
    client = current_app.live_client
    history = request.args.get("history", default=False)
    if history:
        client = current_app.history_client
    pro_data = client.pro_data
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
    altitude = zip(
        resultats.to_dict()["timestamp"].values(),
        resultats.to_dict()["altitude"].values(),
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
    data_altitude = list(
        {"t": timestamp.timestamp() * 1000, "y": str(t)}
        for timestamp, t in altitude
    )
    return json.dumps(
        [
            data_turb,
            data_vsi_std,
            data_vsb_std,
            data_criterion,
            data_threshold,
            data_altitude,
        ]
    )


@base_bp.route("/planes.geojson")
@base_bp.route("/planes.geojson/<path:und>")
def fetch_planes_Geojson(und=None) -> dict:
    client = current_app.live_client
    history = request.args.get("history", default=False)
    if history:
        client = current_app.history_client
    data = client.traffic
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
        data = data.query(f"timestamp<='{str(t)}'")
    return geojson_plane(data)


@base_bp.route("/sigmet.geojson")
@base_bp.route("/sigmet.geojson/<path:wef>,<path:und>")
def fetch_sigmets(wef=None, und=None) -> dict:
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = int(wef) / 1000
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
@base_bp.route("/airep.geojson/<path:wef>,<path:und>")
def airep_geojson(wef=None, und=None):
    condition = wef is None and und is None
    if not condition:
        wef = int(wef) / 1000
        und = int(und) / 1000
    data = current_app.airep.aireps(wef, und)
    if data is not None:
        if condition:
            t = pd.Timestamp("now", tz="utc")
            data = data.query("expire>@t")
        result = data._to_geo()
    else:
        result = {}
    return result


@base_bp.route("/cat.geojson")
@base_bp.route("/cat.geojson/<path:wef>,<path:und>")
def clear_air_turbulence(wef=None, und=None):
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = int(wef) / 1000
    if und is not None:
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
    res = current_app.cat.metsafe(
        "metgate:cat_mf_arpege01_europe",
        wef=wef,
        bounds="France métropolitaine",
    )
    if res is None:
        res = current_app.cat.metsafe(
            "metgate_archive:cat_mf_arpege01_europe",
            wef=wef,
            bounds="France métropolitaine",
        )
    if res is not None:
        res = res.query("endValidity>@t").query("startValidity<=@t")
    else:
        return {}
    return res._to_geo()


@base_bp.route("/fonts/<path:filename>")
def serve_static(filename):
    return send_from_directory("fonts/", filename)


@base_bp.route("/", methods=["GET", "POST"])
def home_page() -> str:
    min_date = request.args.get("min", default=False)
    max_date = request.args.get("max", default=False)
    form = InfoForm()
    if form.validate_on_submit():
        return redirect(
            url_for(
                "history.database_request",
                min=str(form.startdate.data) + " " + str(form.starttime.data),
                max=str(form.enddate.data) + " " + str(form.endtime.data),
            )
        )

    if min_date is not False and max_date is not False:
        return render_template("index.html", history="True", form=form)

    return render_template(
        "index.html",
        history="False",
        form=form,
        uptime=(datetime.now() - current_app.start_time).seconds,
    )


@base_bp.route("/heatmap.data")
@base_bp.route("/heatmap.data/<path:und>")
def get_heatmap_data(und=None):
    client = current_app.live_client
    history = request.args.get("history", default=False)
    if history:
        client = current_app.history_client
    data = {}
    pro_data = client.pro_data
    if pro_data is not None:
        if und is not None:
            und = int(und) / 1000
            t = pd.Timestamp(und, unit="s", tz="utc")
            pro_data = pro_data.query(f"timestamp<='{str(t)}'")
        turb: Traffic = pro_data.query("turbulence")
        if turb is not None:
            # turb_agg = turb.agg_latlon(
            #     resolution=dict(latitude=5, longitude=5), criterion="max"
            # )
            turb = turb.data[["latitude", "longitude", "turbulence"]].dropna()
            data = [
                [i.latitude, i.longitude, 1 if i.turbulence else 0]
                for i in turb.itertuples()
            ]
    return {"data": data}


@base_bp.route("/trajectory/<path:icao>")
def get_traj(icao: str):
    client = current_app.live_client
    history = request.args.get("history", default=False)
    if history:
        client = current_app.history_client
    data = client.pro_data
    features = []
    if data is not None:
        flight = data[icao]
        if flight.shape is not None:
            try:
                x = flight.geojson()
                x.update(
                    {
                        "properties": {
                            "icao": flight.icao24,
                        }
                    }
                )
                features.append(x)
            except Exception as e:
                print(e)
                print(flight.icao24)

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson
