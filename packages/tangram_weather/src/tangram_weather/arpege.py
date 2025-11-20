import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Literal

import httpx
import pandas as pd
import xarray as xr
from tqdm.auto import tqdm

bare_url = "https://object.data.gouv.fr/meteofrance-pnt/pnt/"

# fmt:off
DEFAULT_LEVELS_37 = [
    100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450,
    500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
]
DEFAULT_IP1_FEATURES = ['u', 'v', 't', 'r']
# fmt:on

tempdir = Path(tempfile.gettempdir())
log = logging.getLogger(__name__)


async def download_with_progress(
    client: httpx.AsyncClient, url: str, file: Path
) -> None:
    try:
        async with client.stream("GET", url) as r:
            if r.status_code != 200:
                raise httpx.HTTPStatusError(
                    f"Error downloading data from {url}", request=r.request, response=r
                )

            total_size = int(r.headers.get("Content-Length", 0))
            with file.open("wb") as buffer:
                with tqdm(
                    total=total_size,
                    unit="B",
                    unit_scale=True,
                    desc=url.split("/")[-1],
                ) as progress_bar:
                    first_chunk = True
                    async for chunk in r.aiter_bytes():
                        if first_chunk and chunk.startswith(b"<?xml"):
                            raise RuntimeError(
                                f"Error downloading data from {url}. "
                                "Check if the requested data is available."
                            )
                        first_chunk = False
                        await asyncio.to_thread(buffer.write, chunk)
                        progress_bar.update(len(chunk))
    except (httpx.RequestError, RuntimeError) as e:
        if file.exists():
            file.unlink()
        raise e


async def latest_data(
    client: httpx.AsyncClient,
    hour: pd.Timestamp,
    model: str = "ARPEGE",
    resolution: Literal["025", "01"] = "025",
    package: Literal["SP1", "SP2", "IP1", "IP2", "IP3", "IP4", "HP1"] = "IP1",
    time_range: Literal[
        "000H024H",  # on the 0.25 degree grid
        "025H048H",  # on the 0.25 degree grid
        "049H072H",  # on the 0.25 degree grid
        "073H102H",  # on the 0.25 degree grid
        "000H012H",  # on the 0.1 degree grid
        "013H024H",  # on the 0.1 degree grid
        "025H036H",  # on the 0.1 degree grid
        "037H048H",  # on the 0.1 degree grid
        "049H060H",  # on the 0.1 degree grid
        "061H072H",  # on the 0.1 degree grid
        "073H084H",  # on the 0.1 degree grid
        "085H096H",  # on the 0.1 degree grid
        "097H102H",  # on the 0.1 degree grid
    ] = "000H024H",
    recursion: int = 0,
) -> xr.Dataset:
    """
    Fetch the latest ARPEGE data for a given hour.
    """
    # let's give them time to upload data to the repo
    runtime = (hour - pd.Timedelta("2h")).floor("6h")

    url = f"{bare_url}{runtime.isoformat()}/"
    url += f"{model.lower()}/{resolution}/{package}/"
    filename = f"{model.lower()}__{resolution}__{package}__"
    filename += f"{time_range}__{runtime.isoformat()}.grib2"
    filename = filename.replace("+00:00", "Z")
    url += filename
    url = url.replace("+00:00", "Z")

    if not (tempdir / filename).exists():
        # If the file does not exist, we try to download it.
        try:
            await download_with_progress(client, url, tempdir / filename)
        except Exception:
            (tempdir / filename).unlink(missing_ok=True)  # remove the file if it exists
            # If the download fails, we try to fetch the latest data
            # (or survive with older data we may have in the /tmp directory)
            if recursion >= 3:
                raise  # do not insist too much in history
            return await latest_data(
                client,
                hour - pd.Timedelta("6h"),
                model,
                resolution,
                package,
                time_range,
                recursion + 1,
            )

    def _load_and_process_dataset() -> xr.Dataset:
        log.info(f"Loading dataset from {tempdir / filename}")
        ds = xr.open_dataset(
            tempdir / filename,
            engine="cfgrib",
            backend_kwargs={
                "filter_by_keys": {
                    "typeOfLevel": "isobaricInhPa",
                    "level": DEFAULT_LEVELS_37,
                }
            },
        )
        ds = ds.assign(step=ds.time + ds.step).drop_vars("time")
        ds = ds.rename(step="time")
        return ds  # type: ignore

    return await asyncio.to_thread(_load_and_process_dataset)
