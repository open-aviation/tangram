import os

from flask import Blueprint, abort, current_app, render_template
from werkzeug.utils import redirect

history_bp = Blueprint("history", __name__)


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
        current_app.client.start_from_file(file=abs_path, reference="LFBO")
        return redirect("/True")

    # Show directory contents
    files = os.listdir(abs_path)
    return render_template("files.html", files=files)
