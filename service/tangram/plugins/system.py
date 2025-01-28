import json
import logging
import time
from datetime import UTC, datetime
import pandas as pd
import redis

# from tangram.plugins.history import HistoryDB

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)

# history_db = HistoryDB(read_only=True)


DT_FMT = "%H:%M:%S"


# def aircraft_on_map():
#     total = history_db.count_tracks()
#     el = "plane_count"
#     return {
#         "el": el,
#         "html": f"""<p style="display: inline" id="{el}">{total}</p>""",
#     }
#


def uptime_html(counter):
    el = "uptime"
    return {
        "el": el,
        "html": f"""<span id="{el}">{pd.Timedelta(counter, unit="s")}</span>""",
    }


def info_utc_html(dtfmt=DT_FMT):
    el = "info_utc"
    now_utc = datetime.now(UTC)
    return {
        "el": el,
        "html": f"""<span id="{el}">{now_utc.strftime(dtfmt)}</span>""",
        'now': now_utc.isoformat(),
    }


def info_local_html(dtfmt=DT_FMT):
    el = "info_local"
    now_utc = datetime.now(UTC)
    return {
        "el": el,
        "html": f"""<span id="{el}">{datetime.now().strftime(dtfmt)}</span>""",
        'now': now_utc.isoformat(),
    }


def server_events(redis_url: str):
    counter = 0
    redis_client = redis.Redis.from_url(redis_url)

    log.info("serving system events ...")
    while True:
        redis_client.publish("to:system:update-node", json.dumps(uptime_html(counter)))
        redis_client.publish("to:system:update-node", json.dumps(info_utc_html()))
        redis_client.publish("to:system:update-node", json.dumps(info_local_html()))
        # redis_client.publish("to:system:update-node", json.dumps(aircraft_on_map()))
        counter += 1
        time.sleep(1)


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", dest="redis_url", default=os.getenv("REDIS_URL", "redis://redis:6379"))
    args = parser.parse_args()
    server_events(args.redis_url)
