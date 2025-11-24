import base64
import io
import logging

import numpy as np
import pandas as pd
import tangram_core
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from PIL import Image

from .arpege import latest_data as latest_arpege_data

logger = logging.getLogger(__name__)

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
    isobaric: int, backend_state: tangram_core.InjectBackendState
) -> ORJSONResponse:
    logger.info("fetching wind data for %s", isobaric)

    now = pd.Timestamp.now(tz="UTC").floor("1h")
    ds = await latest_arpege_data(backend_state.http_client, now)
    res = ds.sel(isobaricInhPa=isobaric, time=now.tz_convert(None))[["u", "v"]]

    u_attrs = res.data_vars["u"].attrs

    bounds = [
        u_attrs["GRIB_longitudeOfFirstGridPointInDegrees"],
        u_attrs["GRIB_latitudeOfLastGridPointInDegrees"],
        u_attrs["GRIB_longitudeOfLastGridPointInDegrees"],
        u_attrs["GRIB_latitudeOfFirstGridPointInDegrees"],
    ]

    u_data = res["u"].values
    v_data = res["v"].values

    valid_data_mask = ~np.isnan(u_data)

    min_val, max_val = -70.0, 70.0
    image_unscale = [min_val, max_val]
    value_range = max_val - min_val

    u_scaled = (np.nan_to_num(u_data, nan=0.0) - min_val) / value_range * 255
    v_scaled = (np.nan_to_num(v_data, nan=0.0) - min_val) / value_range * 255

    rgba_data = np.zeros((*u_data.shape, 4), dtype=np.uint8)
    rgba_data[..., 0] = u_scaled.astype(np.uint8)
    rgba_data[..., 1] = v_scaled.astype(np.uint8)
    rgba_data[..., 3] = np.where(valid_data_mask, 255, 0)

    image = Image.fromarray(rgba_data, "RGBA")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    image_data_uri = f"data:image/png;base64,{img_str}"

    response_content = {
        "imageDataUri": image_data_uri,
        "bounds": bounds,
        "imageUnscale": image_unscale,
    }

    return ORJSONResponse(content=response_content)


plugin = tangram_core.Plugin(frontend_path="dist-frontend", routers=[router])
