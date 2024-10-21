from __future__ import annotations

import os
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any
import contextlib

# import anyio
from httpx import Response, request
import redis.asyncio as redis
from fastapi import FastAPI, WebSocket, status

# from fastapi.staticfiles import StaticFiles
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from tangram import websocket as tangram_websocket

from tangram.plugins import web_event
from tangram.plugins import rs1090_source
from tangram.plugins import system
from tangram.plugins import history
from tangram.plugins import trajectory
from tangram.plugins import trajectory_subscriber
from tangram.plugins import coordinate
from tangram.plugins import filter_jet1090

# from tangram.plugins import source
# from tangram.plugins import source_task
# from tangram.plugins import chart

from tangram.plugins.common import rs1090
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client

log = logging.getLogger("tangram")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")
jet1090_restful_client = rs1090.Rs1090Client()


async def connect_jet1090(*args: Any, **kwargs: Any) -> None:
    log.info("%s\n\n\n\n", "=" * 40)
    log.info("startup, %s, %s", args, kwargs)

    RS1090_SOURCE_BASE_URL = os.getenv("RS1090_SOURCE_BASE_URL")
    if RS1090_SOURCE_BASE_URL is None:
        log.error("RS1090_SOURCE_BASE_URL not set")
        exit(1)

    websocket_url = RS1090_SOURCE_BASE_URL.replace("http", "ws") + "/websocket"
    await jet1090_websocket_client.connect_async(websocket_url)


jet1090_websocket_task = None


async def start_jet1090_client() -> None:
    global jet1090_websocket_task

    jet1090_websocket_task = asyncio.create_task(jet1090_websocket_client.start_async())
    log.info("created websocket client task: %s", jet1090_websocket_client)


async def stop_jet1090_client():
    global jet1090_websocket_task

    if jet1090_websocket_task:
        jet1090_websocket_task.cancel()


async def disconnect_jet1090():
    pass


jet1090_client_task = None


async def shutdown_debug(*args: Any, **kwargs: Any) -> None:
    """debugging"""
    global jet1090_websocket_task

    if jet1090_websocket_task:
        jet1090_websocket_task.cancel()
    log.info("shutdown, args: %s, kwargs: %s", args, kwargs)
    log.info("%s\n\n\n\n", "=" * 40)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("starting up...")

    # create a redis connection pool
    # linter complains about the type of app.redis_connection_pool, consider subclass FastAPI
    app.redis_connection_pool = redis.ConnectionPool.from_url(REDIS_URL)

    # # create the websocket connection to jet1090,
    # TODO: remove this
    await connect_jet1090()

    await tangram_websocket.broadcast.connect()  # initialize the websocket broadcast

    # listen for web ui events
    await web_event.startup(REDIS_URL)

    # listen for `jet1090_full`, filter items and pulibsh again
    await filter_jet1090.startup(REDIS_URL)

    # builds the `planes` geospatial keys
    await coordinate.startup(REDIS_URL)

    await system.startup()

    # pull jet1090 restful api and publish
    # NOTE: checking the data now, i.e data from jet1090 /all is not correct, is it?
    await rs1090_source.start()

    # NOTE: is this blocking the event loop?
    # TODO: once the websocket from tangram to jet1090 is removed, this should build the history from redis
    # await history.startup()
    # Let's try with with redis storage
    await history.startup_redis(REDIS_URL)

    await trajectory.app.startup()
    await trajectory_subscriber.startup(REDIS_URL)

    await start_jet1090_client()

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


# tangram_module_root = pathlib.Path(__file__).resolve().parent
# templates = Jinja2Templates(directory=tangram_module_root / "templates")
# TODO: subclass FastAPI to add redis_connection
app = FastAPI(lifespan=lifespan)

# app.mount("/static", StaticFiles(directory=tangram_module_root / "static"), name="static")
app.mount("/plugins/rs1090", rs1090_source.rs1090_app, name="rs1090")  # HACK:?

# app.include_router(source.app)
# app.include_router(system.app)
# app.include_router(history.app)
# app.include_router(chart.app)
# app.include_router(trajectory.app)


start_time = datetime.now()


def get_uptime_seconds() -> float:
    return (datetime.now() - start_time).total_seconds()


@app.get("/uptime")
async def uptime() -> dict[str, float]:
    return {"uptime": get_uptime_seconds()}


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    return await jet1090_restful_client.icao24_track(icao24) or []
    # return await rs1090_source.icao24_track(rs1090_source.BASE_URL + "/track", icao24)


@app.websocket("/websocket")
async def websocket_handler(ws: WebSocket) -> None:
    await ws.accept()
    log.info("%s\n", "-" * 20)

    client_id: str = str(uuid.uuid4())
    log.info("connected, ws: %s, client: %s", ws, client_id)
    await tangram_websocket.handle_websocket_client(client_id, ws)
    log.info("connection done, ws: %s, client: %s", ws, client_id)
    log.info("%s\n", "+" * 20)


async def get_receiver_latlong():
    # from env
    RS1090_SOURCE_BASE_URL = os.getenv("RS1090_SOURCE_BASE_URL")
    if RS1090_SOURCE_BASE_URL is None:
        log.error("RS1090_SOURCE_BASE_URL not set")
        return None, None

    url = f"{RS1090_SOURCE_BASE_URL}/receivers"
    log.info("getting receivers from %s ...", url)
    resp: Response = request("GET", url)
    receivers = resp.json()
    log.debug("receivers: %s %s", type(receivers), receivers)

    reference = {} if not receivers else receivers[0]["reference"]
    ref_latitude, ref_longitude = reference.get("latitude", 0), reference.get("longitude", 0)
    return ref_latitude, ref_longitude


@app.get("/planes")
async def list_planes():
    ref_latitude, ref_longitude = await get_receiver_latlong()
    radius_km = 12000
    return await coordinate.search_planes(
        app.redis_connection_pool, radius_km=radius_km, ref_latitude=ref_latitude, ref_longitude=ref_longitude
    )


@app.get("/planes/{icao24}")
async def get_plane(icao24: str):
    return await coordinate.plane_history(app.redis_connection_pool, icao24)


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
