from __future__ import annotations

import logging
from typing import Literal

from fastapi import FastAPI

from tangram.common import rs1090

log = logging.getLogger("tangram")
jet1090_restful_client = rs1090.Rs1090Client()
app = FastAPI()

file_handler = logging.FileHandler("/tmp/tangram/tangram.log")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
log.addHandler(file_handler)
log.setLevel(logging.DEBUG)


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]


@app.get("/hi")
async def greeting() -> Literal["hello, world!"]:
    return "hello, world!"
