import pandas as pd
from fastapi import APIRouter, FastAPI
from fastapi.responses import ORJSONResponse

from .arpege import latest_data as latest_arpege_data

# Create a router for your plugin
router = APIRouter(
    prefix="/fastmeteo",  # All routes will be prefixed with /fastmeteo
    tags=["fastmeteo"],  # For API documentation organization
    responses={404: {"description": "Not found"}},
)


@router.get("/")
async def get_fastmeteo() -> dict[str, str]:
    """An example endpoint that returns some data."""
    return {"message": "This is the FastMeteo plugin response"}


@router.get("/wind")
async def wind(isobaric: int = 300) -> ORJSONResponse:
    print("Fetching wind data")

    now = pd.Timestamp.now(tz="UTC").floor("1h")
    ds = latest_arpege_data(now)
    res = ds.sel(isobaricInhPa=isobaric, time=now.tz_convert(None))[["u", "v"]]

    return ORJSONResponse(content=res.to_dict())


# This function will be called by the main FastAPI application
# Place it in __init__.py to register the plugin
def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)
