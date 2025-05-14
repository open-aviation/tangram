from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastmeteo.data import Arpege

from tangram.common import rs1090

log = logging.getLogger("tangram")
jet1090_restful_client = rs1090.Rs1090Client()
app = FastAPI()

fmg = Arpege(local_store="/tmp/arpege-zarr/")

log_file = Path("/tmp/tangram/tangram.log")
log_file.parent.mkdir(parents=True, exist_ok=True)
file_handler = logging.FileHandler(log_file)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
log.addHandler(file_handler)
log.setLevel(logging.DEBUG)


@app.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]


@app.get("/wind")
async def wind(bounds: str, resolution: int = 20) -> JSONResponse:
    try:
        south, west, north, east = map(float, bounds.split(","))
    except ValueError:
        return JSONResponse(
            content={"error": "Invalid bounds format. Use 'south,west,north,east'"},
            status_code=400,
        )
    lat, lon, alt, time = np.meshgrid(
        np.linspace(south, north, resolution + 1),
        np.linspace(west, east, resolution + 1),
        30000,
        pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=1),
        indexing="ij",
    )

    GRID_POINTS = pd.DataFrame(
        {
            "latitude": lat.ravel(),
            "longitude": lon.ravel(),
            "altitude": alt.ravel(),
            "timestamp": time.ravel(),
        }
    )

    res = (
        fmg.interpolate(GRID_POINTS)
        .assign(timestamp=lambda df: df.timestamp.astype("int64"))
        .to_dict(orient="list")
    )

    return JSONResponse(content=res)


@app.get("/hi")
async def greeting() -> Literal["hello, world!"]:
    return "hello, world!"
