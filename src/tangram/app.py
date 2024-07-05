from __future__ import annotations

import asyncio
import logging
import pathlib
import uuid
from datetime import datetime
from typing import Any, Dict

from fastapi import FastAPI, Request, WebSocket, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.responses import HTMLResponse

from tangram import websocket as tangram_websocket
from tangram.plugins import rs1090_source, rs1090_trajectory
from tangram.settings import tangram_settings  # noqa
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client
from tangram.plugins import history

log = logging.getLogger("tangram")


async def startup_debug(*args: Any, **kwargs: Any) -> None:
    """debugging"""
    log.info("%s\n\n\n\n", "=" * 40)
    log.info("startup, %s, %s", args, kwargs)

    websocket_url = "ws://192.168.8.37:8080/websocket"
    await jet1090_websocket_client.async_connect(websocket_url)
    task = asyncio.create_task(jet1090_websocket_client.start_async())
    log.info("created websocket client task: %s", task)


async def shutdown_debug(*args: Any, **kwargs: Any) -> None:
    """debugging"""
    log.info("%s\n\n\n\n", "=" * 40)
    log.info("shutdown, args: %s, kwargs: %s", args, kwargs)


tangram_module_root = pathlib.Path(__file__).resolve().parent
templates = Jinja2Templates(directory=tangram_module_root / "templates")
app = FastAPI(
    on_startup=[
        startup_debug,
        tangram_websocket.broadcast.connect,
        rs1090_source.start,
        rs1090_trajectory.start,
    ],
    on_shutdown=[
        shutdown_debug,
        tangram_websocket.broadcast.disconnect,
        rs1090_source.shutdown,
        rs1090_trajectory.shutdown,
    ],
)

app.mount("/static", StaticFiles(directory=tangram_module_root / "static"), name="static")
app.mount("/plugins/rs1090", rs1090_source.rs1090_app, name="rs1090")
app.mount("/plugins/trajectory", rs1090_trajectory.app, name="trajectory")
app.include_router(history.app)

start_time = datetime.now()


def get_uptime_seconds() -> float:
    return (datetime.now() - start_time).total_seconds()


@app.get("/uptime")
async def uptime() -> dict[str, float]:
    return {"uptime": get_uptime_seconds()}


@app.get("/")
async def home(request: Request, history: int = 0) -> HTMLResponse:
    log.info("index, history: %s", history)
    context = dict(
        history=history,
        form_database=None,
        form_threshold=None,
        uptime=get_uptime_seconds(),
    )
    return templates.TemplateResponse(request=request, name="index.html", context=context)


@app.get("/trajectory/{icao24}")
async def trajectory(icao24: str) -> Dict[str, Any]:
    track = await rs1090_source.icao24_track(rs1090_source.BASE_URL + "/track", icao24)
    geojson = {
        "type": "LineString",
        "coordinates": [(elt["longitude"], elt["latitude"]) for elt in track if elt.get("longitude", None)]
        if track is not None
        else [],
        "properties": {
            "icao24": icao24,
            "latest": max(elt["timestamp"] for elt in track) if track is not None else 0,
        },
    }
    return geojson


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[dict[str, Any]]:
    return await rs1090_source.icao24_track(rs1090_source.BASE_URL + "/track", icao24)


@app.get("/turb.geojson")
async def turbulence() -> Dict[str, Any]:
    return {}


@app.get("/planes.geojson")
async def fetch_planes_geojson() -> Dict[str, Any]:
    return {}


@app.websocket("/websocket")
async def websocket_handler(ws: WebSocket) -> None:
    await ws.accept()
    log.info("%s\n", "-" * 20)

    client_id: str = str(uuid.uuid4())
    log.info("connected, ws: %s, client: %s", ws, client_id)
    await tangram_websocket.handle_websocket_client(client_id, ws)
    log.info("connection done, ws: %s, client: %s", ws, client_id)
    log.info("%s\n", "+" * 20)


class PublishMessage(BaseModel):
    """Message for Channel publishing"""

    channel: str
    event: str = "new-data"
    message: str | None = None


@app.post("/admin/publish")
async def channel_publish(message: PublishMessage) -> None:
    if not message.message:
        log.error("empty payload, no publish in channels")
        return status.HTTP_400_BAD_REQUEST
    await tangram_websocket.publish_any(message.channel, message.event, message.message)
    return status.HTTP_204_NO_CONTENT


@app.get("/admin/channel-clients")
async def get_map() -> dict[str, set[str]]:
    return tangram_websocket.hub.channel_clients()


@app.get("/admin/channels")
async def list_channels() -> list[str]:
    return tangram_websocket.hub.channels()


@app.get("/admin/clients")
async def clients() -> list[str]:
    return tangram_websocket.hub.clients()
