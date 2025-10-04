from __future__ import annotations

import json
import logging
import pathlib
import uuid
from datetime import datetime
from typing import Any, Dict

from fastapi import FastAPI, Request, WebSocket, status
from fastapi.concurrency import run_until_first_complete
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.responses import HTMLResponse

from tangram import websocket as tangram_websocket
from tangram.plugins import rs1090_source
from tangram.util.geojson import geojson_fp

log = logging.getLogger("tangram")


async def shutdown(*args: Any, **kwargs: Any) -> None:
    """debugging"""
    log.info("%s\n\n\n\n", "=" * 40)


async def start_publish_job(*args: Any, **kwargs: Any) -> None:
    log.info("<PR> start task")
    await rs1090_source.publish_runner.start_task()
    log.info("<PR> task created: %s", rs1090_source.publish_runner.task)


async def shutdown_publish_job() -> None:
    log.info("shutting down publish runner task: %s", rs1090_source.publish_runner.task)
    if rs1090_source.publish_runner.task is None:
        log.warning("publish runner task is None")
        return

    if rs1090_source.publish_runner.task.done():
        rs1090_source.publish_runner.task.result()
    else:
        rs1090_source.publish_runner.task.cancel()
    log.info("shutdown - publish job done")


tangram_module_root = pathlib.Path(__file__).resolve().parent
templates = Jinja2Templates(directory=tangram_module_root / "templates")
app = FastAPI(
    on_startup=[
        tangram_websocket.broadcast.connect,
        start_publish_job,
        # rs1090_source.start_publish_job,
    ],
    on_shutdown=[
        tangram_websocket.broadcast.disconnect,
        shutdown_publish_job,
        # rs1090_source.shutdown_publish_job,
        shutdown,
    ],
)

app.mount(
    "/static", StaticFiles(directory=tangram_module_root / "static"), name="static"
)
app.mount("/plugins/rs1090", rs1090_source.rs1090_app, name="rs1090")

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
    return templates.TemplateResponse(
        request=request, name="index.html", context=context
    )


@app.get("/trajectory/{icao24}")
async def trajectory(icao24: str) -> Dict[str, Any]:
    track = await rs1090_source.icao24_track(rs1090_source.BASE_URL + "/track", icao24)
    geojson = {
        "type": "LineString",
        "coordinates": [
            (elt["longitude"], elt["latitude"])
            for elt in track
            if elt.get("longitude", None)
        ]
        if track is not None
        else [],
        "properties": {
            "icao24": icao24,
            "latest": max(elt["timestamp"] for elt in track)
            if track is not None
            else 0,
        },
    }
    return geojson


@app.get("/fp.geojson")
def fp():
    return geojson_fp()


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
