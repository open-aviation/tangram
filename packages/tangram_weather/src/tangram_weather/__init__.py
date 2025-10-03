from logging import getLogger

import pandas as pd
import tangram
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from .arpege import latest_data as latest_arpege_data

logger = getLogger(__name__)

router = APIRouter(
    prefix="/weather",
    tags=["weather"],
    responses={404: {"description": "Not found"}},
)


@router.get("/")
async def get_weather() -> dict[str, str]:
    return {"message": "This is the weather plugin response"}


@router.get("/wind")
async def wind(
    isobaric: int, backend_state: tangram.InjectBackendState
) -> ORJSONResponse:
    logger.info("fetching wind data for %s", isobaric)

    now = pd.Timestamp.now(tz="UTC").floor("1h")
    ds = await latest_arpege_data(backend_state.http_client, now)
    res = ds.sel(isobaricInhPa=isobaric, time=now.tz_convert(None))[["u", "v"]]

    return ORJSONResponse(content=res.to_dict())


plugin = tangram.Plugin(frontend_path="dist-frontend", routers=[router])
