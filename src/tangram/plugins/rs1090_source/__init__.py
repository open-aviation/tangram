from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, List

import dotenv
import httpx
from fastapi import FastAPI
from tangram import websocket as channels
from tangram.websocket import ChannelHandlerMixin, ClientMessage, register_channel_handler

dotenv.load_dotenv()
log = logging.getLogger(__name__)

client = httpx.AsyncClient()

# reading config from environment varables, TBD: consider a config section
# jet1090 service
BASE_URL = os.environ.get("RS1090_BASE_URL", "http://127.0.0.1:8080")
DEBUG = os.environ.get("RS1090_SOURCE_DEBUG")

# TODO add models for data endpoints


# TODO proper type
async def all(url: str) -> dict[str, Any] | None:
    """instant position
    sample record for `/all`
    {
        "icao24": "c078ac",
        "first": 1713076085,
        "last": 1713076126,
        "callsign": null,
        "squawk": null,
        "latitude": null,
        "longitude": null,
        "altitude": null,
        "selected_altitude": 26000,
        "groundspeed": null,
        "vertical_rate": 64,
        "track": null,
        "ias": 300,
        "tas": null,
        "mach": 0.728,
        "roll": null,
        "heading": 163.828125,
        "nacp": 9
    }
    """
    try:
        # log.debug("requesting %s ...", url)
        resp = await client.get(url)
        if resp.status_code not in [200]:
            logging.error("fail to get `all` from %s, status: %s", url, resp.status_code)
            return None
        # log.debug("got data from jet1090 service")
        return resp.json()  # type: ignore
    except httpx.ConnectError:
        log.error("fail to connection jet1090 service, please check %s", url)
        return None
    except Exception:  # catch all
        log.exception("fail to get data from jet1090 service")
        return None


async def endpoint_stats(url: str):
    """get receiver status from rs1090
    item example:
    {
      "host": "0.0.0.0",
      "port": 41126,
      "rtlsdr": false,
      "airport": "LFMA",
      "reference": {
        "latitude": 43.50528,
        "longitude": 5.367222
      },
      "count": 89,
      "last": 1716820385
    }
    """
    async with httpx.AsyncClient() as aclient:
        resp = await aclient.get(url)
        return resp.json()


async def list_identifiers(url) -> List[str]:
    async with httpx.AsyncClient() as aclient:
        resp = await aclient.get(url)
        return resp.json()


async def icao24_track(url, identifier):
    """ICAO24 5 minutes historical positions
    sample record for `/track?icao24=010117`
    {
        "timestamp": 1713076152.4026532,
        "frame": "",
        "df": "17",
        "icao24": "010117",
        "bds": "05",
        "NUCp": 7,
        "NICb": 0,
        "altitude": 34000,
        "source": "barometric",
        "parity": "odd",
        "lat_cpr": 103579,
        "lon_cpr": 18181,
        "latitude": 47.533698647709215,
        "longitude": 10.511169433593748,
        "idx": 3
    }
    """
    params = {"icao24": identifier}
    resp = await client.get(url, params=params)
    if resp.status_code not in [200]:
        logging.error(
            "fail to get 5-minutes `track` from %s for %s, status: %s",
            url,
            identifier,
            resp.status_code,
        )
        return None
    return resp.json()


# ==== plugin event handler examle
# TODO make this module or class
# TODO API definition
# TODO decorator
# TODO [IDEA] history search example, consider DUCKDB
_events_of_interest = {}


def add_event_filter(payload):
    # TODO model for different event should define by handler
    log.info("add event filter: %s", payload)

    event_type, event_value = payload.get("key"), payload.get("value")
    log.info("expect to filter by %s => %s", event_type, event_value)

    if event_type not in _events_of_interest:
        _events_of_interest[event_type] = set()
    _events_of_interest[event_type].add(event_value)
    log.info("event filter: %s", _events_of_interest)


def reset_event_filter(payload):
    log.info("reset event filter: %s", payload)
    _events_of_interest.clear()


event_handlers = {
    "filter": add_event_filter,
    "reset-filter": reset_event_filter,
}


class Rs1090SourceChannelHandler(ChannelHandlerMixin):
    pass


rs1090_source_channel_handler = Rs1090SourceChannelHandler("channel:streaming")
register_channel_handler(rs1090_source_channel_handler)


@rs1090_source_channel_handler.on_channel_event(event_pattern="event:select")
async def handle_select(client_id: str, message: ClientMessage):
    log.info("%s selects icao24: %s", client_id, message.payload)


# ==== plugin data source example


class Rs1090Data:
    def __init__(self, base_url: str):
        self.base_url: str = base_url

    async def forward_from_http(self, source_fn, params=None):
        source_data = await source_fn(**params)
        if not source_data:
            # log.error("no data loaded from rs1090, url: %s", self.base_url)
            return
        # log.info(
        #     "icao24: %s ... (total: %s)",
        #     ", ".join([el["icao24"] for el in source_data if "icao24" in el][:3]),
        #     len(source_data),
        # )

        # hook from client, filter data from the source
        if "filter" in event_handlers and _events_of_interest:
            result_source_data = []
            for key, values in _events_of_interest.items():
                result_source_data.extend([el for el in source_data if el.get(key) in values])

            log.info(
                "source data: %s, filtered source_data: %s",
                len(source_data),
                len(result_source_data),
            )
            source_data = result_source_data

        try:
            # log.info("publishing (len: %s)...", len(source_data))
            await channels.publish_any("channel:streaming", "new-data", source_data)
        except Exception:
            # it will fail for the first time for sure
            log.exception("<RS> fail to publish")
        # log.info("<RS> published")

    async def all(self):
        """all positions"""
        return await all(self.base_url + "/all")

    async def icao24_tracks(self, identifier):
        """ICAO24 5 minutes historical positions"""
        return await icao24_track(self.base_url + "/track", identifier)


#### plugin mounint object (and functions)


class PublishRunner:
    def __init__(self):
        self.running = True
        self.counter = 0
        self.task = None

    async def start_task(self):
        log.debug("<PR> starting task ...")
        self.task = asyncio.create_task(self.run())
        log.debug("<PR> task created")

    async def run(self, internal_seconds=1):
        rs1090_data = Rs1090Data(BASE_URL)

        log.info("<PR> start forwarding ...")
        while self.running:
            await rs1090_data.forward_from_http(rs1090_data.all, {})
            # log.info("<PR> /all data forwarded")

            self.counter += 1
            await asyncio.sleep(internal_seconds)  # one second
        log.info("<PR> forwarding job done")

    async def states(self):
        return {
            "running": self.running,
            "counter": self.counter,
            "task": self.task.done() if self.task else None,
        }


publish_runner = PublishRunner()
rs1090_app = FastAPI()


# Per documents, events are not fired in sub app.
# @rs1090_app.on_event('startup')
async def start() -> None:
    log.info("startup - publish job task created")
    await publish_runner.start_task()
    log.info("publish job created: %s", publish_runner.task)


async def shutdown() -> None:
    log.info("shuting down publish runner task: %s", publish_runner.task)
    if publish_runner.task is None:
        log.warning("publish runner task is None")
        return

    if publish_runner.task.done():
        publish_runner.task.result()
    else:
        publish_runner.task.cancel()
    log.info("shutdown - publish job done")


@rs1090_app.get("/health")
async def health_check():
    return "It looks good!"


@rs1090_app.post("/publish-job/start")
async def start_publish_job_handler():
    log.info("start PublishRunner task ...")
    await publish_runner.start_task()
    log.info("stared: %s", publish_runner.task)
    return "done"


@rs1090_app.get("/publish-job/state")
async def publish_job_health():
    return await publish_runner.states()


@rs1090_app.get("/receivers")
async def receivers():
    return await endpoint_stats(BASE_URL + "/receivers")


@rs1090_app.get("/identifiers")
async def list():
    return await list_identifiers(BASE_URL + "/")


@rs1090_app.get("/all")
async def list_all():
    return await all(BASE_URL + "/all")
