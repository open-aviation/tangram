import pandas as pd
from fastapi import APIRouter, FastAPI
from fastapi.responses import ORJSONResponse

from .arpege import latest_data as latest_arpege_data

# Create a router for your plugin
router = APIRouter(
    prefix="/weather",  # All routes will be prefixed with /weather
    tags=["weather"],  # For API documentation organization
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
    ds = latest_arpege_data(now)
    res = ds.sel(isobaricInhPa=isobaric, time=now.tz_convert(None))[["u", "v"]]

    return ORJSONResponse(content=res.to_dict())


def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)
