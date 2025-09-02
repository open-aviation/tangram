import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import NoReturn

import psutil
import redis.asyncio as redis
import tangram

log = logging.getLogger(__name__)


def uptime(counter: int) -> dict[str, str]:
    return {
        "el": "uptime",
        "value": f"{timedelta(seconds=counter)}",
    }


def info_utc() -> dict[str, str | int]:
    return {
        "el": "info_utc",
        "value": 1000 * int(datetime.now(timezone.utc).timestamp()),
    }


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


async def server_events(redis_client: redis.Redis) -> NoReturn:
    counter = 0
    log.info("serving system events...")

    while True:
        await redis_client.publish("to:system:update-node", json.dumps(uptime(counter)))
        await redis_client.publish("to:system:update-node", json.dumps(info_utc()))
        await redis_client.publish("to:system:update-node", json.dumps(cpu_load()))
        await redis_client.publish("to:system:update-node", json.dumps(ram_usage()))
        counter += 1

        await asyncio.sleep(1)

plugin = tangram.Plugin(frontend_path="dist-frontend")

@plugin.register_service()
async def run_system(backend_state: tangram.BackendState) -> None:
    await server_events(backend_state.redis_client)
