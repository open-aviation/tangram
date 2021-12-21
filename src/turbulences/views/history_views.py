import json
import os

from flask import Blueprint, abort, current_app, render_template
from werkzeug.utils import redirect

history_bp = Blueprint("history", __name__)


@history_bp.route("/history/map")
def create_map() -> str:
    return render_template("map.html")


@history_bp.route("/test")
def test() -> str:
    BASE_DIR = os.path.join(current_app.data_path)
    abs_path = os.path.join(BASE_DIR, "test.pkl")
    current_app.client.start_from_file(file=abs_path, reference="LFBO")
    return render_template("test.html")


@history_bp.route("/test/prodata.json")
def get_prodata():
    liste = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        turb = pro_data
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    liste = [flight]
    resultats = liste[0].data
    x = zip(
        {value for value in resultats.to_dict()["timestamp"].values()},
        resultats.to_dict()["turbulence"].values(),
    )
    data = list({"x": timestamp.timestamp(), "y": t} for timestamp, t in x)
    return json.dumps(data)


@history_bp.route("/data", defaults={"req_path": ""})
@history_bp.route("/data/<path:req_path>")
def dir_listing(req_path):
    BASE_DIR = os.path.join(current_app.data_path)

    # Joining the base and the requested path
    abs_path = os.path.join(BASE_DIR, req_path)

    # Return 404 if path doesn't exist
    if not os.path.exists(abs_path):
        return abort(404)

    # Check if path is a file and redirect
    if os.path.isfile(abs_path):
        current_app.client.clear()
        current_app.client.start_from_file(file=abs_path, reference="LFBO")
        return redirect("/history/map")

    # Show directory contents
    files = os.listdir(abs_path)
    return render_template("files.html", files=files)
