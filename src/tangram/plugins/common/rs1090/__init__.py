import logging
import os

import dotenv
import httpx
from pydantic import BaseModel, Field

dotenv.load_dotenv()
log = logging.getLogger(__name__)


class Jet1090Data(BaseModel):
    idx: int
    icao24: str
    df: int | None = None
    # first: int | None = None

    last: float | None
    timestamp: float | None = None
    # TODO: when it's websocket timed_message, field name is `timestamp`
    # last: float | None = Field(alias="timestamp")

    latitude: float | None = None
    longitude: float | None = None
    altitude: float | None = None
    # callsign: str | None = None
    # squawk: str | None = None
    # selected_altitude: float | None = None
    # groundspeed: float | None = None
    # vertical_rate: float | None = None
    # track: float | None = None
    # ias: float | None = None
    # tas: float | None = None
    # mach: float | None = None
    # roll: float | None = None
    # heading: float | None = None
    # nacp: float | None = None


class Reference(BaseModel):
    latitude: float
    longitude: float


class Receiver(BaseModel):
    host: str
    port: int
    rtlsdr: bool
    airport: str
    reference: Reference
    count: int
    last: int


class Rs1090Client:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("RS1090_BASE_URL")
        if not self.base_url:
            raise Exception("add `base_url` parameter or set RS1090_BASE_URL environment varables")

        self.aclient = httpx.AsyncClient()

    async def request_rs1090(self, path, params=None):  # -> None | list[Jet1090Data]:
        url = self.base_url + path
        params = params or {}
        try:
            log.debug("requesting %s ...", url)
            resp = await self.aclient.get(url, params=params)
            if resp.status_code not in [200]:
                logging.error("fail to get %s, status: %s, %s", url, resp.status_code, resp.text)
                return None
            log.debug("got data from jet1090 service")
            return resp.json()
        except httpx.ConnectError:
            log.error("fail to connection jet1090 service, please check %s", url)
            return None
        except Exception:  # catch all
            log.exception("fail to get data from jet1090 service")
            return None

    async def all(self, path: str | None = None) -> list[Jet1090Data] | None:
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
        items = await self.request_rs1090(path or "/all")
        return [Jet1090Data(**item) for item in items] if items is not None else None

    async def receivers(self, path: str) -> Receiver | None:
        """get receiver status from rs1090 `/receivers` endpoint
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
        return await self.request_rs1090(path or "/receivers")

    async def list_identifiers(self, path: str | None = None) -> list[str]:
        return await self.request_rs1090(path or "/") or []

    async def icao24_track(self, identifier: str, path: str | None = "/track") -> list[Jet1090Data] | None:
        """ICAO24 1 minute historical positions
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
        items = await self.request_rs1090(path or "/track", params={"icao24": identifier})
        if not items:
            return None

        results = []
        for item in items:
            if "last" not in item:
                item["last"] = item["timestamp"]
            results.append(Jet1090Data(**item))
        return results
