import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import NoReturn

import psutil
import redis.asyncio as redis
from fastapi import FastAPI
from tangram.config import TangramConfig

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


async def server_events(redis_url: str) -> NoReturn:
    counter = 0
    redis_client = redis.Redis.from_url(redis_url)

    log.info("serving system events...")

    while True:
        await redis_client.publish("to:system:update-node", json.dumps(uptime(counter)))
        await redis_client.publish("to:system:update-node", json.dumps(info_utc()))
        await redis_client.publish("to:system:update-node", json.dumps(cpu_load()))
        await redis_client.publish("to:system:update-node", json.dumps(ram_usage()))
        counter += 1

        await asyncio.sleep(1)


# This function will be called by the main FastAPI application
# Place it in __init__.py to register the plugin
def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    config: TangramConfig = app.state.config
    redis_url = config.core.redis_url
    log.info("System events service started in background task")

    task = asyncio.create_task(server_events(redis_url))
    app.state.background_tasks.add(task)
    task.add_done_callback(app.state.background_tasks.discard)
