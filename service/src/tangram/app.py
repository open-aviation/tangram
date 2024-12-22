from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import uuid
from datetime import datetime
from typing import Any

import redis.asyncio as redis
from fastapi import FastAPI, Request, WebSocket, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# import anyio
from httpx import Response, request
from pydantic import BaseModel

from tangram import websocket as channel
from tangram.plugins import coordinate, filter_jet1090, system, trajectory_subscriber, web_event
from tangram.plugins.common import rs1090

log = logging.getLogger("tangram")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")

jet1090_restful_client = rs1090.Rs1090Client()
jet1090_websocket_task: None | asyncio.Task[None] = None
jet1090_client_task: None | asyncio.Task[None] = None


async def connect_jet1090(*args: Any, **kwargs: Any) -> None:
    log.info("%s\n\n\n\n", "=" * 40)
    log.info("startup, %s, %s", args, kwargs)

    RS1090_SOURCE_BASE_URL = os.getenv("RS1090_SOURCE_BASE_URL")
    if RS1090_SOURCE_BASE_URL is None:
        log.error("RS1090_SOURCE_BASE_URL not set")
        exit(1)

    # check environment variables
    log.info("REDIS: %s", REDIS_URL)
    log.info("JET1090: %s", os.getenv("RS1090_SOURCE_BASE_URL"))


async def shutdown_debug(*args: Any, **kwargs: Any) -> None:
    """debugging"""
    log.info("shutdown, args: %s, kwargs: %s", args, kwargs)
    log.info("%s\n\n\n\n", "=" * 40)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("starting up... (%s)", log)

    # create a redis connection pool
    # linter complains about the type of app.redis_connection_pool, consider subclass FastAPI
    app.redis_connection_pool = redis.ConnectionPool.from_url(REDIS_URL)

    await channel.broadcast.connect()  # initialize the websocket broadcast

    # listen for web UI events
    await web_event.startup(REDIS_URL)

    # listen for `jet1090_full`, filter and pulibsh again
    await filter_jet1090.startup(REDIS_URL)

    # builds the `planes` geospatial keys
    await coordinate.startup(REDIS_URL)

    # System UI events
    await system.startup()

    # Build the history
    # This plugin takes time to restart, consider move it to process_compose
    # await history.startup(REDIS_URL)

    # FIXME: history is not persisted correctly, it fails to load the trajectory for now
    # await trajectory.app.startup()
    await trajectory_subscriber.startup(REDIS_URL)

    log.debug("yield to request handling ...")
    yield  # The application is now running and serving requests

    log.debug("shutting down...")
    # TODO: task for cleanup, they are disabled for now
    #
    # await system.shutdown()
    # await trajectory_subscriber.shutdown()
    # await trajectory.app.shutdown()
    # await coordinate.shutdown()
    # await history.shutdown()
    # await rs1090_source.shutdown()
    # await web_event.shutdown()

    # await stop_jet1090_client()
    # await tangram_websocket.broadcast.disconnect()

    # TODO: close this pool
    # app.redis_connection_pool.close()

    log.info("shutdown complete")


app = FastAPI(lifespan=lifespan)

# working at src/
app.mount("/static", StaticFiles(directory="tangram/static"), name="static")
templates = Jinja2Templates(directory="tangram/templates")

start_time = datetime.now()


def get_uptime_seconds() -> float:
    return (datetime.now() - start_time).total_seconds()


@app.get("/uptime")
async def uptime() -> dict[str, float]:
    return {"uptime": get_uptime_seconds()}


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.latitude is not None and r.longitude is not None]


@app.websocket("/websocket")
async def websocket_handler(ws: WebSocket) -> None:
    await ws.accept()
    log.info("%s\n", "-" * 20)

    client_id: str = str(uuid.uuid4())
    log.info("connected, ws: %s, client: %s", ws, client_id)
    await channel.handle_websocket_client(client_id, ws)
    log.info("connection done, ws: %s, client: %s", ws, client_id)
    log.info("%s\n", "+" * 20)


async def get_receiver_latlong():
    # from env
    RS1090_SOURCE_BASE_URL = os.getenv("RS1090_SOURCE_BASE_URL")
    if RS1090_SOURCE_BASE_URL is None:
        log.error("RS1090_SOURCE_BASE_URL not set")
        return None, None

    url = f"{RS1090_SOURCE_BASE_URL}/sensors"
    log.info("getting receivers from %s ...", url)
    resp: Response = request("GET", url)
    receivers = resp.json()
    log.debug("receivers: %s %s", type(receivers), receivers)

    reference = {} if not receivers else receivers[0]["reference"]
    ref_latitude, ref_longitude = reference.get("latitude", 0), reference.get("longitude", 0)
    return ref_latitude, ref_longitude


@app.get("/table")
async def table_page(request: Request):
    return templates.TemplateResponse("table/index.html", {"request": request})


@app.get("/planes")
async def list_planes():
    ref_latitude, ref_longitude = await get_receiver_latlong()
    radius_km = 12000
    return await coordinate.search_planes(app.redis_connection_pool, radius_km=radius_km, ref_latitude=ref_latitude, ref_longitude=ref_longitude)


@app.get("/planes/{icao24}")
async def get_plane(icao24: str):
    return await coordinate.plane_history(app.redis_connection_pool, icao24)


class PublishMessage(BaseModel):
    """Message for Channel publishing"""

    channel: str
    event: str = "new-data"
    message: str | None = None


@app.post("/admin/publish")
async def channel_publish(message: PublishMessage) -> int:
    if not message.message:
        log.error("empty payload, no publish in channels")
        return status.HTTP_400_BAD_REQUEST
    await channel.publish_any(message.channel, message.event, message.message)
    return status.HTTP_204_NO_CONTENT


@app.get("/admin/channel-clients")
async def get_map() -> dict[str, set[str]]:
    return channel.hub.channel_clients()


@app.get("/admin/channels")
async def list_channels() -> list[str]:
    return channel.hub.channels()


@app.get("/admin/clients")
async def clients() -> list[str]:
    return channel.hub.clients()
