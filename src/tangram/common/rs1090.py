import logging
import os
from typing import Any

import dotenv
import httpx
from pydantic import BaseModel

dotenv.load_dotenv()
log = logging.getLogger(__name__)


class Jet1090Data(BaseModel):
    idx: int | None = None
    icao24: str
    df: int | None = None
    # first: int | None = None

    last: float | None = None
    lastseen: float | None = None
    timestamp: float | None = None
    # TODO: when it's websocket timed_message, field name is `timestamp`
    # last: float | None = Field(alias="timestamp")

    latitude: float | None = None
    longitude: float | None = None
    altitude: float | None = None
    # callsign: str | None = None
    # squawk: str | None = None
    selected_altitude: float | None = None
    groundspeed: float | None = None
    vertical_rate: float | None = None
    track: float | None = None
    IAS: float | None = None
    TAS: float | None = None
    Mach: float | None = None
    roll: float | None = None
    heading: float | None = None
    vrate_barometric: float | None = None
    vrate_inertial: float | None = None


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
    base_url: str

    def __init__(self, base_url: str | None = None) -> None:
        base_url = base_url or os.environ.get("JET1090_URL", "http://jet1090:8080")
        if base_url is None:
            raise ValueError("JET1090_URL is not set")
        self.base_url = base_url

        self.aclient = httpx.AsyncClient()

    async def request_rs1090(
        self, path: str, params: Any = None
    ) -> None | list[str | dict[str, Any]]:
        url = self.base_url + path
        params = params or {}
        try:
            log.debug("requesting %s ...", url)
            resp = await self.aclient.get(url, params=params)
            if resp.status_code not in [200]:
                logging.error(
                    "fail to get %s, status: %s, %s", url, resp.status_code, resp.text
                )
                return None
            log.debug("got data from jet1090 service")
            return resp.json()  # type: ignore
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

    # async def receivers(self, path: str) -> Receiver | None:
    #     """get receiver status from rs1090 `/receivers` endpoint
    #     item example:
    #     {
    #     "host": "0.0.0.0",
    #     "port": 41126,
    #     "rtlsdr": false,
    #     "airport": "LFMA",
    #     "reference": {
    #         "latitude": 43.50528,
    #         "longitude": 5.367222
    #     },
    #     "count": 89,
    #     "last": 1716820385
    #     }
    #     """
    #     return await self.request_rs1090(path or "/receivers")

    async def list_identifiers(self, path: str | None = None) -> list[str]:
        """list all icao24 identifiers, `/list`"""
        return await self.request_rs1090(path or "/") or []

    async def icao24_track(
        self, identifier: str, path: str | None = "/track"
    ) -> list[Jet1090Data] | None:
        """ICAO24 1 minute historical positions, `/track?icao24=010117`"""
        items = await self.request_rs1090(
            path or "/track", params={"icao24": identifier}
        )
        if not items:
            return None

        return [self.flatten(item) for item in items]

    def flatten(self, item: dict[str, Any]) -> Jet1090Data:
        if bds50 := item.get("bds50", None):
            item |= bds50
            del item["bds50"]
        if bds60 := item.get("bds60", None):
            item |= bds60
            del item["bds60"]
        return Jet1090Data(**item)
