import asyncio
import logging
import os
import json

import dotenv
import httpx
from fastapi import FastAPI
from tangram.util.geojson import BetterJsonEncoder

dotenv.load_dotenv()
# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(lineno)s - %(message)s')
log = logging.getLogger(__name__)


BASE_URL = os.environ.get("RS1090_SOURCE_BASE_URL", 'http://127.0.0.1:8008')
DEBUG = os.environ.get("RS1090_SOURCE_DEBUG")

# TODO add models for data endpoints


async def all(url):
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
    async with httpx.AsyncClient() as aclient:
        log.debug("requesting %s ...", url)
        resp = await aclient.get(url)
        if resp.status_code not in [200]:
            logging.error(
                "fail to get `all` from %s, status: %s", url, resp.status_code
            )
            return None
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
    async with httpx.AsyncClient() as client:
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


async def publish(url, channel, event, json_data):
    payload = {
        "channel": channel,
        "event": event,
        "message": json.dumps(json_data, cls=BetterJsonEncoder),
    }

    async with httpx.AsyncClient() as client:
        await client.post(url, json=payload)


# ==== plugin event handler examle
# TODO make this module or class
# TODO API definition
# TODO decorator
# TODO [IDEA] history search example, consider DUCKDB
_events_of_interest = {}


def add_event_filter(payload):
    # TODO model for different event should define by handler
    log.info('add event filter: %s', payload)

    event_type, event_value = payload.get('key'), payload.get('value')
    log.info('expect to filter by %s => %s', event_type, event_value)

    if event_type not in _events_of_interest:
        _events_of_interest[event_type] = set()
    _events_of_interest[event_type].add(event_value)
    log.info('event filter: %s', _events_of_interest)


def reset_event_filter(payload):
    log.info('reset event filter: %s', payload)
    _events_of_interest.clear()


event_handlers = {
    'filter': add_event_filter,
    'reset-filter': reset_event_filter,
}


# ==== plugin data source example

class Rs1090Data:

    def __init__(self, base_url: str, publish_url: str):
        self.base_url: str = base_url
        self.publish_url: str = publish_url

    async def forward_from_http(self, source_fn, params=None):
        source_data = await source_fn(**params)
        log.info('icao24: %s', [el['icao24'] for el in source_data if 'icao24' in el])
        if 'filter' in event_handlers and _events_of_interest:
            result_source_data = []
            for key, values in _events_of_interest.items():
                result_source_data.extend([el for el in source_data if el.get(key) in values])

            log.info('source data: %s, filtered source_data: %s', len(source_data), len(result_source_data))
            source_data = result_source_data

        try:
            log.info(
                "<RS> publish at %s (len: %s)...",
                self.publish_url,
                len(source_data),
            )
            await publish(
                self.publish_url, "channel:streaming", "new-data", source_data
            )
        except Exception:
            # it will fail for the first time for sure
            log.exception("<RS> fail to publish")
        log.info("<RS> published")

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

    async def run(self, internal_seconds=3):
        rs1090_data = Rs1090Data(
            BASE_URL, "http://127.0.0.1:18000/admin/publish"
        )

        log.info("<PR> start forwarding ...")
        while self.running:
            await rs1090_data.forward_from_http(rs1090_data.all, {})
            log.info("<PR> /all data forwarded")

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
async def start_publish_job() -> None:
    log.info("startup - publish job task created")
    # ts = asyncio.create_task(publish_runner.run())
    # log.info('publish job created: %s', ts)


async def shutdown_publish_job() -> None:
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


@rs1090_app.get("/all")
async def list_all():
    return all(BASE_URL + "/all")


@rs1090_app.get("/track/icao24/{identifier}")
def list_5min_tracks(identifier: str):
    return icao24_track(BASE_URL + "/track", identifier)
