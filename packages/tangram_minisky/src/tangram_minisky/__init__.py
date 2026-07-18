"""tangram plugin displaying live traffic from a MiniSky simulator.

The plugin connects to a running ``minisky server`` instance, consumes its
``/stream`` WebSocket (full per-tick snapshots in SI units), converts the state
to aviation units and republishes it on the Redis channel bridge so the
frontend map can render the simulated aircraft. A small REST proxy forwards
stack commands (``OP``, ``HOLD``, ``DTMULT``, ``CRE``, ...) to MiniSky so the
simulation can be controlled from the tangram sidebar.

Data flow::

    minisky /stream --> this service --> to:minisky:new-data --> frontend
    frontend --> GET /minisky/stack?cmd=... --> minisky /stack/{cmd}
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Annotated, Any
from urllib.parse import quote

import orjson
import tangram_core
from fastapi import APIRouter, HTTPException
from pydantic import TypeAdapter
from tangram_core.config import FrontendMutable

log = logging.getLogger(__name__)

# SI -> aviation unit factors (match minisky.tools.aero)
FT = 0.3048
KTS = 0.514444
FPM = 0.00508

SIM_STATE_NAMES = {0: "INIT", 1: "HOLD", 2: "OP", 3: "END"}


@dataclass(frozen=True)
class MiniskyConfig:
    minisky_url: str = "http://127.0.0.1:8000"
    channel: str = "minisky"
    stream_max_hz: float = 5.0
    reconnect_interval_secs: float = 3.0
    topbar_order: int = 45
    sidebar_order: int = 45


@dataclass(frozen=True)
class MiniskyFrontendConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    channel: str
    topbar_order: Annotated[int, FrontendMutable()]
    sidebar_order: Annotated[int, FrontendMutable()]


def into_frontend(config: MiniskyConfig) -> MiniskyFrontendConfig:
    return MiniskyFrontendConfig(
        channel=config.channel,
        topbar_order=config.topbar_order,
        sidebar_order=config.sidebar_order,
    )


def _get_config(backend_state: tangram_core.BackendState) -> MiniskyConfig:
    plugin_config = backend_state.config.plugins.get("tangram_minisky", {})
    return TypeAdapter(MiniskyConfig).validate_python(plugin_config)


router = APIRouter(
    prefix="/minisky",
    tags=["minisky"],
    responses={404: {"description": "Not found"}},
)


@router.get("/stack")
async def stack_command(
    cmd: str, backend_state: tangram_core.InjectBackendState
) -> Any:
    """Forward a stack command to the MiniSky simulator and return its echo."""
    config = _get_config(backend_state)
    url = f"{config.minisky_url}/stack/{quote(cmd, safe='')}"
    try:
        response = await backend_state.http_client.get(url, timeout=10.0)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        log.error(f"failed to forward stack command {cmd!r} to MiniSky: {e}")
        raise HTTPException(status_code=502, detail=f"MiniSky unreachable: {e}")


@router.get("/commands")
async def commands(backend_state: tangram_core.InjectBackendState) -> Any:
    """Forward MiniSky's command dictionary (for console autocomplete)."""
    config = _get_config(backend_state)
    try:
        response = await backend_state.http_client.get(
            f"{config.minisky_url}/commands", timeout=10.0
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"MiniSky unreachable: {e}")


def convert_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Convert a MiniSky SI-unit snapshot into the frontend payload.

    Aircraft come out with jet1090-style field names and aviation units
    (altitude in ft, speeds in kt, vertical rate in fpm).
    """
    siminfo = snapshot.get("siminfo", {})
    acdata = snapshot.get("acdata", {})

    state = int(siminfo.get("state", 0))
    out_siminfo = {
        "simt": float(siminfo.get("simt", 0.0)),
        "simdt": float(siminfo.get("simdt", 0.0)),
        "simutc": siminfo.get("simutc"),
        "speed": float(siminfo.get("speed", 1.0)),
        "ntraf": int(siminfo.get("ntraf", 0)),
        "state": state,
        "state_name": SIM_STATE_NAMES.get(state, "?"),
        "scenname": siminfo.get("scenname"),
        "nconf_cur": acdata.get("nconf_cur", 0),
        "nlos_cur": acdata.get("nlos_cur", 0),
    }

    callsigns = acdata.get("callsign", [])
    n = len(callsigns)

    def col(name: str) -> list:
        values = acdata.get(name, [])
        return values if len(values) == n else [None] * n

    lat, lon = col("lat"), col("lon")
    alt, trk, vs = col("alt"), col("trk"), col("vs")
    tas, cas, gs = col("tas"), col("cas"), col("gs")
    typecode, inconf = col("typecode"), col("inconf")

    aircraft = []
    for i in range(n):
        aircraft.append(
            {
                "id": str(callsigns[i]),
                "callsign": str(callsigns[i]),
                "typecode": typecode[i],
                "latitude": lat[i],
                "longitude": lon[i],
                "altitude": round(alt[i] / FT) if alt[i] is not None else None,
                "groundspeed": round(gs[i] / KTS, 1) if gs[i] is not None else None,
                "tas": round(tas[i] / KTS, 1) if tas[i] is not None else None,
                "ias": round(cas[i] / KTS, 1) if cas[i] is not None else None,
                "vertical_rate": round(vs[i] / FPM) if vs[i] is not None else None,
                "track": trk[i],
                "inconf": bool(inconf[i]) if inconf[i] is not None else False,
            }
        )

    return {"aircraft": aircraft, "count": n, "siminfo": out_siminfo}


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    config_class=MiniskyConfig,
    frontend_config_class=MiniskyFrontendConfig,
    into_frontend_config_function=into_frontend,
)


@plugin.register_service()
async def run_minisky_stream(backend_state: tangram_core.BackendState) -> None:
    """Relay MiniSky's /stream WebSocket onto the tangram Redis channel bridge.

    Reconnects forever, so the simulator can be started/stopped independently
    of tangram. Publishes a status message on connect/disconnect so the
    frontend can show whether a simulator is attached.
    """
    import websockets

    config = _get_config(backend_state)
    redis_client = backend_state.redis_client

    ws_url = config.minisky_url.replace("http", "ws", 1) + "/stream"
    data_topic = f"to:{config.channel}:new-data"
    status_topic = f"to:{config.channel}:status"
    min_interval = 1.0 / config.stream_max_hz if config.stream_max_hz > 0 else 0.0

    log.info(f"MiniSky stream relay starting, source {ws_url}")

    while True:
        try:
            async with websockets.connect(ws_url) as ws:
                log.info(f"connected to MiniSky at {ws_url}")
                await redis_client.publish(
                    status_topic, orjson.dumps({"connected": True})
                )
                last_publish = 0.0
                async for raw in ws:
                    now = time.monotonic()
                    if now - last_publish < min_interval:
                        continue
                    last_publish = now
                    payload = convert_snapshot(orjson.loads(raw))
                    await redis_client.publish(data_topic, orjson.dumps(payload))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(
                f"MiniSky stream unavailable ({e}); "
                f"retrying in {config.reconnect_interval_secs}s"
            )
            try:
                await redis_client.publish(
                    status_topic, orjson.dumps({"connected": False})
                )
            except Exception:
                pass
            await asyncio.sleep(config.reconnect_interval_secs)
