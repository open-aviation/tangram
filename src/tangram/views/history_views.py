from typing import Tuple

from flask import (
    Blueprint,
    Response,
    current_app,
    request,
    url_for,
)
from flask_cors import CORS
from pymongo.cursor import Cursor
from werkzeug.utils import redirect

from pandas import Timestamp

from ..client.turbulence import TurbulenceClient

history_bp = Blueprint("history", __name__)
CORS(history_bp)


def get_date_file() -> Tuple[Timestamp, Timestamp]:
    client: TurbulenceClient = current_app.history_client
    return (
        client.pro_data.start_time,
        client.pro_data.end_time,
    )


@history_bp.route("/database", methods=["GET", "POST"])
def database_request() -> Response:
    wef = request.args.get("min", default=False)
    und = request.args.get("max", default=False)
    req = {
        "stop": {"$gte": wef},
        "start": {"$lte": und},
    }
    data: Cursor = current_app.mongo.db.tracks.find(req)
    current_app.history_client.start_from_database(data)
    date = get_date_file()
    return redirect(
        url_for("base.home_page", min=date[0], max=date[1], history=1)
    )
