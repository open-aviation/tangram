import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, NoReturn

import orjson
import psutil
import redis.asyncio as redis
import tangram_core
from tangram_core.config import FrontendMutable

log = logging.getLogger(__name__)


@dataclass
class SystemConfig:
    topbar_order: int = 0


@dataclass
class SystemFrontendConfig(tangram_core.config.HasTopbarUiConfig):
    topbar_order: Annotated[int, FrontendMutable()]


def into_frontend(config: SystemConfig) -> SystemFrontendConfig:
    return SystemFrontendConfig(topbar_order=config.topbar_order)


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
        load1, _load5, _load15 = psutil.getloadavg()
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
        await redis_client.publish(
            "to:system:update-node", orjson.dumps(uptime(counter))
        )
        await redis_client.publish("to:system:update-node", orjson.dumps(info_utc()))
        await redis_client.publish("to:system:update-node", orjson.dumps(cpu_load()))
        await redis_client.publish("to:system:update-node", orjson.dumps(ram_usage()))
        counter += 1

        await asyncio.sleep(1)


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    config_class=SystemConfig,
    frontend_config_class=SystemFrontendConfig,
    into_frontend_config_function=into_frontend,
)


@plugin.register_service()
async def run_system(backend_state: tangram_core.BackendState) -> None:
    await server_events(backend_state.redis_client)
