import os
from flask_cors import CORS
from flask import (
    Blueprint,
    abort,
    current_app,
    render_template,
    request,
    url_for,
)
from werkzeug.utils import redirect

history_bp = Blueprint("history", __name__)
CORS(history_bp)


def get_date_file():
    client = current_app.history_client
    return (
        client.pro_data.start_time,
        client.pro_data.end_time,
    )


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
        current_app.history_client.start_from_file(
            file=abs_path, reference="LFBO"
        )
        date = get_date_file()
        return redirect(url_for("base.home_page", min=date[0], max=date[1]))

    # Show directory contents
    files = os.listdir(abs_path)
    return render_template("files.html", files=files)


@history_bp.route("/database", methods=["GET", "POST"])
def database_request():
    wef = request.args.get("min", default=False)
    und = request.args.get("max", default=False)
    req = {
        "stop": {"$gte": wef},
        "start": {"$lte": und},
    }
    data = current_app.mongo.db.tracks.find(req)
    current_app.history_client.start_from_database(data)
    date = get_date_file()
    return redirect(url_for("base.home_page", min=date[0], max=date[1]))
