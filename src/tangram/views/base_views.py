import json
import logging
from datetime import datetime
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from flask import (
    Blueprint,
    Response,
    current_app,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_cors import CORS
from requests.exceptions import HTTPError

from ..client.turbulence import TurbulenceClient
from ..util.geojson import geojson_fp, geojson_traffic, geojson_turbulence
from ..views.forms import DatabaseForm, ThresholdForm

log = logging.getLogger(__name__)
base_bp = Blueprint("base", __name__)
CORS(base_bp)


@base_bp.route("/fp.geojson")
def fetch_fp():
    return geojson_fp()


@base_bp.route("/stop")
def stop_client() -> Dict:
    current_app.live_client.stop()
    return {}


@base_bp.route("/context/flight/<path:icao>")
def get_info_flight(icao) -> Dict[str, Any]:
    try:
        data = current_app.network.icao24(icao)
    except HTTPError:
        data = {}
    return data


@base_bp.app_template_filter("format_time")
def format_datetime(value, format="medium"):
    return f"{value:%Y-%m-%d %H:%M:%S}"


@base_bp.route("/uptime")
def get_uptime() -> Dict[str, Any]:
    return {"uptime": (datetime.now() - current_app.start_time).total_seconds()}


@base_bp.route("/turb.geojson")
def turbulence() -> Dict[str, Any]:
    client = current_app.live_client
    history = request.args.get("history", default=0, type=int)
    und = request.args.get("und", default="")
    icao24 = request.args.get("icao24", default="")
    callsign = request.args.get("callsign", default="")
    standard = True
    if history:
        standard = False
        client = current_app.history_client

    pro_data = client.pro_data

    if icao24 not in (None, ""):
        standard = False
        pro_data = pro_data.query(f"icao24=='{str(icao24)}'")
    if callsign not in (None, ""):
        standard = False
        pro_data = pro_data.query(f"callsign=='{str(callsign)}'")
    if und not in (None, ""):
        standard = False
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
        pro_data = pro_data.query(f"timestamp<='{str(t)}'")

    if standard:
        return current_app.request_builder.turb_result
    else:
        return geojson_turbulence(pro_data)


@base_bp.route("/chart.data/<path:icao>")
def chart_data(icao: str) -> List[List]:
    client = current_app.live_client
    history = request.args.get("history", default=0, type=int)
    if history:
        client = current_app.history_client
    pro_data = client.pro_data
    if pro_data is None:
        return {}
    resultat = pro_data[icao].data
    ts = resultat["timestamp"].to_json(orient="values", date_format="epoch")
    altitude = resultat["altitude"].to_json(orient="values")
    turb = (
        resultat["turbulence"]
        .replace(False, np.NAN)
        .replace(True, 1)
        .to_json(orient="values")
    )
    vsi = resultat["vertical_rate_inertial"].to_json(orient="values")
    vsb = resultat["vertical_rate_barometric"].to_json(orient="values")
    cri = resultat["criterion"].to_json(orient="values")
    thr = resultat["threshold"].to_json(orient="values")
    altitude = resultat["altitude"].to_json(orient="values")
    vsi_std = resultat["vertical_rate_inertial_std"].to_json(orient="values")
    vsb_std = resultat["vertical_rate_barometric_std"].to_json(orient="values")
    # resultat[['timesta']].tojson(orient="values")
    return {
        "ts": json.loads(ts),
        "turb": json.loads(turb),
        "vsi": json.loads(vsi),
        "vsb": json.loads(vsb),
        "cri": json.loads(cri),
        "thr": json.loads(thr),
        "altitude": json.loads(altitude),
        "vsi_std": json.loads(vsi_std),
        "vsb_std": json.loads(vsb_std),
    }


@base_bp.route("/planes.geojson")
def fetch_planes_Geojson() -> Dict[str, Any]:
    client = current_app.live_client
    history = request.args.get("history", default=0, type=int)
    und = request.args.get("und", default="")
    icao24 = request.args.get("icao24", default="")
    callsign = request.args.get("callsign", default="")
    standard = True
    if history:
        standard = False
        client = current_app.history_client
    data = client.traffic

    if icao24 not in (None, ""):
        standard = False
        data = data.query(f"icao24=='{str(icao24)}'")
    if callsign not in (None, ""):
        standard = False
        data = data.query(f"callsign=='{str(callsign)}'")

    if und not in (None, ""):
        standard = False
        und = int(und) / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")
        data = data.query(f"timestamp<='{str(t)}'")
    if standard:
        return current_app.request_builder.planes_position
    else:
        return geojson_traffic(data)


@base_bp.route("/context/sigmet")
def fetch_sigmets() -> Any:
    if not hasattr(current_app, "sigmet"):
        log.warning("sigmet is not initialized for the app")
        return {}

    wef = request.args.get("wef", default=None, type=int)
    und = request.args.get("und", default=None, type=int)
    t = pd.Timestamp("now", tz="utc")  # noqa: F841
    if wef is not None:
        wef = wef / 1000
    if und is not None:
        und = und / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")  # noqa: F841
    res = current_app.sigmet.sigmets(wef, und, fir="^(L|E)")
    if res is not None:
        res = res.query("validTimeTo>@t")._to_geo()
    else:
        res = {}
    return res


@base_bp.route("/context/airep")
def airep_geojson() -> Any:
    if not hasattr(current_app, "airep"):
        log.warning("airep is not initialized for the app")
        return {}

    wef = request.args.get("wef", default=None, type=int)
    und = request.args.get("und", default=None, type=int)
    condition: bool = wef is not None and und is not None
    if condition:
        wef = wef / 1000
        und = und / 1000
    data = current_app.airep.aireps(wef, und)
    if data is not None:
        if not condition:
            t = pd.Timestamp("now", tz="utc")  # noqa: F841
            data = data.query("expire>@t")
        result = data._to_geo()
    else:
        result = {}
    return result


@base_bp.route("/context/cat")
def clear_air_turbulence() -> Any:
    if not hasattr(current_app, "cat"):
        log.warning("cat is not initialized for the app")
        return {}

    wef = request.args.get("wef", default=None, type=int)
    und = request.args.get("und", default=None, type=int)
    t = pd.Timestamp("now", tz="utc")
    if wef is not None:
        wef = wef / 1000
    if und is not None:
        und = und / 1000
        t = pd.Timestamp(und, unit="s", tz="utc")  # noqa: F841
    log.info("cat: %s", current_app.cat)
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
def serve_fonts(filename: str) -> Response:
    return send_from_directory("fonts/", filename)


@base_bp.route("/static/<path:filename>")
def serve_static(filename: str) -> Response:
    response = send_from_directory("static/", filename)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@base_bp.route("/", methods=["GET", "POST"])
def home_page() -> Response:
    client: TurbulenceClient = current_app.live_client
    history = request.args.get("history", default=0, type=int)
    if history:
        client: TurbulenceClient = current_app.history_client

    form_database = DatabaseForm()
    if form_database.validate_on_submit():
        return redirect(
            url_for(
                "history.database_request",
                min=(
                    str(form_database.startdate.data)
                    + " "
                    + str(form_database.starttime.data)
                ),
                max=(
                    str(form_database.enddate.data)
                    + " "
                    + str(form_database.endtime.data)
                ),
            )
        )

    form_threshold = ThresholdForm()
    if form_threshold.validate_on_submit():
        client.set_min_threshold(form_threshold.threshold.data)
        client.set_multiplier(form_threshold.multiplier.data)
        client.turbulence()
    else:
        form_threshold.threshold.data = client.get_min_threshold()
        form_threshold.multiplier.data = client.get_multiplier()
    if history:
        return render_template(
            "index.html",
            history=1,
            form_database=form_database,
            form_threshold=form_threshold,
        )
    return render_template(
        "index.html",
        history=0,
        form_database=form_database,
        form_threshold=form_threshold,
        uptime=get_uptime()["uptime"],
    )


@base_bp.route("/trajectory/<path:icao24>")
def get_traj(icao24: str) -> Dict[str, Any]:
    client = current_app.live_client
    history = request.args.get("history", default=0, type=int)
    if history:
        client = current_app.history_client
    und = request.args.get("und", default=0, type=float)
    pro_data = client.pro_data
    flight = pro_data[icao24]
    geojson_f = []
    if flight is not None:
        if und not in (None, 0):
            und = int(und) / 1000
            t = pd.Timestamp(und, unit="s", tz="utc")
            flight = flight.query(f"timestamp<='{str(t)}'")
        geojson_f = flight.geojson()
        if geojson_f is not None:
            geojson_f.update(
                {
                    "properties": {
                        "icao": icao24,
                    }
                }
            )
    encapsulated_geojson = {
        "geojson": geojson_f,
    }
    return encapsulated_geojson
