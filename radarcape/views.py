import pandas as pd
from flask import (
    Blueprint,
    current_app,
    render_template,
    send_from_directory,
)
from traffic.data import session
from .converter import (
    geojson_trajectoire,
    geojson_airep,
    geojson_plane,
)


bp = Blueprint("liste_vols", __name__)


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
