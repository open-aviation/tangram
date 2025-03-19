from __future__ import annotations

import logging
# from datetime import datetime

from fastapi import FastAPI

from tangram.plugins.common import rs1090


log = logging.getLogger("tangram")
jet1090_restful_client = rs1090.Rs1090Client()
app = FastAPI()

# start_time = datetime.now()
#
# def get_uptime_seconds() -> float:
#     return (datetime.now() - start_time).total_seconds()
#
#
# @app.get("/uptime")
# async def uptime() -> dict[str, float]:
#     return {"uptime": get_uptime_seconds()}


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]
