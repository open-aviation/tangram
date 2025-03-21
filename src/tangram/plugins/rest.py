from __future__ import annotations

import logging
from fastapi import FastAPI
from tangram.plugins.common import rs1090


log = logging.getLogger("tangram")
jet1090_restful_client = rs1090.Rs1090Client()
app = FastAPI()


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]


@app.get("/hi")
async def greeting():
    return "hello, world!"
