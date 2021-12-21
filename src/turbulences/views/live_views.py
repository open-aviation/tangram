from flask import Blueprint, render_template

live_bp = Blueprint("live", __name__)


@live_bp.route("/live/map")
def create_map() -> str:
    return render_template("map.html", history=False)
