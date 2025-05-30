import json
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import NoReturn

import psutil
import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


def uptime(counter: int) -> dict[str, str]:
    return {
        "el": "uptime",
        "value": f"{timedelta(seconds=counter)}",
    }


def info_utc() -> dict[str, str | int]:
    return {"el": "info_utc", "value": 1000 * int(datetime.now(UTC).timestamp())}


def cpu_load() -> dict[str, str]:
    try:
        load1, load5, load15 = psutil.getloadavg()
        cpu_count = psutil.cpu_count(logical=True) or 1
        load_percent = (load1 / cpu_count) * 100
        return {"el": "cpu_load", "value": f"{load_percent:.2f}%"}
    except Exception:
        return {"el": "cpu_load", "value": "Unavailable"}


def ram_usage() -> dict[str, str]:
    try:
        mem = psutil.virtual_memory()
        return {"el": "ram_usage", "value": f"{mem.percent:.2f}%"}
    except Exception:
        return {"el": "ram_usage", "value": "Unavailable"}


def server_events(redis_url: str) -> NoReturn:
    counter = 0
    redis_client = redis.Redis.from_url(redis_url)

    log.info("serving system events...")

    while True:
        redis_client.publish("to:system:update-node", json.dumps(uptime(counter)))
        redis_client.publish("to:system:update-node", json.dumps(info_utc()))
        redis_client.publish("to:system:update-node", json.dumps(cpu_load()))
        redis_client.publish("to:system:update-node", json.dumps(ram_usage()))
        counter += 1

        time.sleep(1)


if __name__ == "__main__":
    import argparse
    import os

    file_handler = logging.FileHandler("/tmp/tangram/system.log")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
    log.addHandler(file_handler)
    log.setLevel(logging.DEBUG)

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
    )
    args = parser.parse_args()
    server_events(args.redis_url)
