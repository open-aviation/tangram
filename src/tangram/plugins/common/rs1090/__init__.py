import logging
import os
from typing import Any

import dotenv
import httpx

dotenv.load_dotenv()
log = logging.getLogger(__name__)


class Rs1090Client:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("RS1090_BASE_URL")
        if not self.base_url:
            raise Exception("add `base_url` parameter or set RS1090_BASE_URL environment varables")

        self.aclient = httpx.AsyncClient()

    async def request_rs1090(self, path, params=None) -> None | Any:
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

    async def all(self, path: str | None = None) -> dict[str, Any] | None:
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
        return await self.request_rs1090(path or "/all")

    async def receivers(self, path: str):
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

    async def icao24_track(self, identifier: str, path: str | None = "/track"):
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
        return await self.request_rs1090(path or "/track", params={"icao24": identifier})
