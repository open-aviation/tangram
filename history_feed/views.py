import os

import pandas as pd
from flask import (
    Blueprint,
    abort,
    current_app,
    render_template,
    send_from_directory,
)
from traffic.data import session
from werkzeug.utils import redirect

from .converter import geojson_airep, geojson_plane, geojson_trajectoire

bp = Blueprint("radarcape", __name__)


@bp.route("/test", methods=["GET"])
def test() -> str:
    return render_template("test.html")


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


@bp.route("/radarcape/airep.json")
def validation_airep():
    utc_now = pd.Timestamp("now", tz="utc")
    c = session.get(
        "https://api.airep.info/aireps?wef=" + utc_now.strftime("%Y-%m-%d"),
        headers={"Authorization": f"Bearer {current_app.airep_token}"},
    )
    c.raise_for_status()

    return c.json()


@bp.route("/radarcape/airep.geojson")
def convert_airep_geojson():
    utc_now = pd.Timestamp("now", tz="utc")
    data = validation_airep()
    result = []
    for d in data:
        if pd.Timestamp(d["expire"]) > utc_now:
            result.append(d)
    return geojson_airep(result)


@bp.route("/data", defaults={"req_path": ""})
@bp.route("/data/<path:req_path>")
def dir_listing(req_path):
    BASE_DIR = os.path.join(current_app.root_path, "data")

    # Joining the base and the requested path
    abs_path = os.path.join(BASE_DIR, req_path)

    # Return 404 if path doesn't exist
    if not os.path.exists(abs_path):
        return abort(404)

    # Check if path is a file and redirect
    if os.path.isfile(abs_path):
        current_app.client.clear()
        current_app.client.start_from_file(file=abs_path, reference="LFBO")
        return redirect("/radarcape/map")

    # Show directory contents
    files = os.listdir(abs_path)
    return render_template("files.html", files=files)
