from flask import Blueprint, render_template, send_from_directory, current_app

live_bp = Blueprint("live", __name__)


# maybe move that to base_views TODO
@live_bp.route("/fonts/<path:filename>")
def serve_static(filename):
    return send_from_directory("fonts/", filename)


@live_bp.route("/")
def home_page() -> str:
    data = current_app.airep.aireps()
    if data is not None:
        results = [x["properties"] for x in data._to_geo()["features"]]
    else:
        results = []
    return render_template("index.html", results=results)


@live_bp.route("/live/map")
def create_map() -> str:
    return render_template("map.html", history=False)
