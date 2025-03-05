from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import pathlib
import uuid
from datetime import datetime
from typing import Any, Optional
import random
import string

import redis.asyncio as redis
from fastapi import FastAPI, Request, WebSocket, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# import anyio
import httpx
from pydantic import BaseModel
from starlette.responses import HTMLResponse

from tangram import channels
from tangram.plugins.common import rs1090
# from tangram.plugins import coordinate, web_event

log = logging.getLogger("tangram")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
JET1090_URL = os.getenv("JET1090_URL", "http://jet1090:8080")

jet1090_restful_client = rs1090.Rs1090Client()
jet1090_websocket_task: None | asyncio.Task[None] = None
jet1090_client_task: None | asyncio.Task[None] = None


async def connect_jet1090(*args: Any, **kwargs: Any) -> None:
    log.info("%s\n\n\n\n", "=" * 40)
    log.info("startup, %s, %s", args, kwargs)

    # check environment variables
    log.info("REDIS: %s", REDIS_URL)
    log.info("JET1090: %s", JET1090_URL)


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

    await channels.broadcast.connect()  # initialize the websocket broadcast

    # listen for web UI events
    # await web_event.startup(REDIS_URL)

    # builds the `planes` geospatial keys
    # await coordinate.startup(REDIS_URL)

    # Trajectory
    # await trajectory.startup(REDIS_URL)

    log.debug("yield to request handling ...")
    yield  # The application is now running and serving requests

    log.debug("shutting down...")
    # TODO: task for cleanup, they are disabled for now
    #
    # await trajectory.shutdown()
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

# working directory is $PROJECT/service/src
tangram_module_root = pathlib.Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=tangram_module_root / "static"), name="static")
templates = Jinja2Templates(directory=tangram_module_root / "templates")

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
    await channels.handle_websocket_client(client_id, ws)
    log.info("connection done, ws: %s, client: %s", ws, client_id)
    log.info("%s\n", "+" * 20)


async def get_receiver_latlong():
    url = f"{JET1090_URL}/sensors"
    log.info("getting receivers from %s ...", url)
    resp: httpx.Response = httpx.request("GET", url)
    receivers = resp.json()
    log.debug("receivers: %s %s", type(receivers), receivers)

    reference = {} if not receivers else receivers[0]["reference"]
    ref_latitude, ref_longitude = reference.get("latitude", 0), reference.get("longitude", 0)
    return ref_latitude, ref_longitude


@app.get("/table")
async def table_page(request: Request):
    return templates.TemplateResponse("table/index.html", {"request": request})
