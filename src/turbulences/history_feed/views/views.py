import os

from flask import (
    Blueprint,
    abort,
    current_app,
    render_template,
    send_from_directory,
)
from werkzeug.utils import redirect

from .converter import geojson_plane

bp = Blueprint("history", __name__)


@bp.route("/test")
def test() -> str:
    BASE_DIR = os.path.join(current_app.root_path, "data/dump_toulouse")
    abs_path = os.path.join(BASE_DIR, "test.pkl")
    current_app.client.start_from_file(file=abs_path, reference="LFBO")
    return render_template("test.html")


@bp.route("/test/prodata.json")
def get_prodata():
    liste = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        turb = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    liste = [flight]
    resultats = liste[0].data
    x = dict(
        zip(
            {
                value.strftime("%Y-%m-%d %X")
                for value in resultats.to_dict()["timestamp"].values()
            },
            resultats.to_dict()["turbulence"].values(),
        )
    )
    # d = []
    # for i, j in x:
    #     d.append({"x": i, "y": j})
    print(len(resultats.to_dict()["timestamp"]))
    print(len(resultats.to_dict()["turbulence"].values()))
    print(x)
    return x


@bp.route("/radarcape/map")
def create_map() -> str:
    return render_template("map.html")


@bp.route("/radarcape/turb.geojson")
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


@bp.route("/radarcape/planes.geojson")
def fetch_planes_Geojson() -> dict:
    data = current_app.client.traffic
    return geojson_plane(data)


@bp.route("/radarcape/sigmet.geojson", defaults={"wef": None, "und": None})
@bp.route("/radarcape/sigmet.geojson/<path:wef>,<path:und>")
def fetch_sigmets(wef, und) -> dict:
    res = current_app.sigmet.sigmets(wef, und, fir="^(L|E)")
    res = res._to_geo()
    return res


@bp.route("/radarcape/plane.png")
def favicon():
    return send_from_directory("./static", "plane.png")


@bp.route("/radarcape/airep.geojson", defaults={"wef": None, "und": None})
@bp.route("/radarcape/airep.geojson/<path:wef>,<path:und>")
def airep_geojson(wef, und):
    data = current_app.airep.aireps(wef, und)
    if data is not None:
        result = data._to_geo()
    else:
        result = {}
    return result


@bp.route("/radarcape/cat.geojson", defaults={"wef": None, "und": None})
@bp.route("/radarcape/cat.geojson/<path:wef>,<path:und>")
def clear_air_turbulence(wef, und):
    res = current_app.cat.metsafe(
        "metgate:cat_mf_arpege01_europe",
        wef=wef,
        und=und,
        bounds="France métropolitaine",
    )
    return res._to_geo()


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
