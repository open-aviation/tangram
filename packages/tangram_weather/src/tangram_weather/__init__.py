import asyncio

import pandas as pd
import tangram
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from .arpege import latest_data as latest_arpege_data

router = APIRouter(
    prefix="/weather",
    tags=["weather"],
    responses={404: {"description": "Not found"}},
)


@router.get("/")
async def get_weather() -> dict[str, str]:
    """An example endpoint that returns some data."""
    return {"message": "This is the weather plugin response"}


@router.get("/wind")
async def wind(isobaric: int = 300) -> ORJSONResponse:
    print("Fetching wind data")

    now = pd.Timestamp.now(tz="UTC").floor("1h")
    ds = await asyncio.to_thread(latest_arpege_data, now)
    res = ds.sel(isobaricInhPa=isobaric, time=now.tz_convert(None))[["u", "v"]]

    return ORJSONResponse(content=res.to_dict())


plugin = tangram.Plugin(frontend_path="dist-frontend", routers=[router])
