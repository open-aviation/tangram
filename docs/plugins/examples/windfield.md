# Add a wind field layer

## Statement of need

Meteorological data is essential for understanding the impact of weather on aviation operations. Meteo France provides weather prediction data from their [ARPEGE model](https://meteofrance.com/actualites-et-dossiers/modeles-prevision-meteo). The most basic features include zonal and meridional wind components, but also temperature, pressure, and humidity. More advanced features are also available but we will not cover them here.

A [web API](https://portail-api.meteofrance.fr/web/en/api/ARPEGE) is available after registration, but we will prefer here the GRIB files that can also be downloaded directly from the [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/donnees-pnt-retention-14-jours/) initiative, also provided by Meteo France under an Open License.

New predictions are published every 6 hours, and the data is available for 3 days in advance. The data is provided in GRIB format, which is a standard format for meteorological data. In each file, each grid point represents spatio-temporal coordinates, and the data is provided for each hour of the day. The data is available at a resolution of 0.1 degrees, which is approximately 11 km at the equator. Altitude is provided in isobars, which is a standard unit for atmospheric pressure.

## Implementation

The `tangram_weather` plugin displays a wind field on the map at a user-specified isobaric level. It consists of a backend service to provide the data and a frontend widget to control and display it.

### 1. Backend: Wind Information API

The `tangram_weather` plugin is a self-contained, installable Python package. Its `pyproject.toml` registers it as a `tangram` plugin via an entry point:

```toml
[project.entry-points."tangram.plugins"]
tangram_weather = "tangram_weather:plugin"
```

The plugin's `src/tangram_weather/__init__.py` file defines a FastAPI `APIRouter` and registers it with the core `tangram` application.

```python
import tangram
from fastapi import APIRouter
# ...

router = APIRouter(...)

@router.get("/wind")
async def wind(isobaric: int = 300) -> ORJSONResponse:
    # ... implementation ...

plugin = tangram.Plugin(routers=[router])
```

The plugin, associated with the `/weather` router will provide an API endpoint to fetch the wind field data for a specific isobar.

The logic for downloading the data is implemented in the `arpege.py` file.

The code is self-explanatory, but the following points are worth noting:

- in `__init__.py`, the `wind(isobaric: int)` function returns a `ORJSONResponse` (from `fastapi.responses`) rather than a `JSONResponse`. This is because the data is large and we want to avoid the overhead of converting it to JSON. The `ORJSONResponse` is a faster alternative, based on [**`orjson`**](https://github.com/ijl/orjson) that can handle large data efficiently. It also automatically deals with datetime objects, which are used in the GRIB data.

!!! tip

    Extra Python libraries can be included with the `uv add` command.

    The command edits both the `pyproject.toml` and the `uv.lock` files:

    ```shell
    uv add xarray cfgrib orjson
    ```

- in `arpege.py`, the download of the GRIB file is wrapped in a try/except block. If the file is not found (or Internet is momentarily unavailable), the function will try to get the previous file (6 hours before) and return it. It can be useful to fallback to older files when the newer versions are not yet available.

- the `xarray` library offers a `load_dataset` and an `open_dataset` function to read GRIB files. The `open_dataset` function is used here, as it allows to read the file without loading it entirely into memory, which is useful for large files.

!!! warning

    There is an issue with the packaging of the `ecCodes` library that is used by `xarray` to read GRIB files. The specific version of the `ecCodes` library for Linux/arm64 is not yet available at the time of writing this documentation.

    **You are most likely to be impacted by this issue if you run this plugin on Apple Silicon Mac computers.**
    In that case, you may want to run `just create-tangram-aarch64` to create a new Docker image with the latest version of the `ecCodes` library. The `just tangram` command will then use this image to run the application.

### 2. Frontend: The `WindFieldLayer`

The frontend component, `WindFieldLayer.vue`, provides the user interface for the wind layer. It is rendered using [Deck.gl](https://deck.gl) and the [`weatherlayers-gl`](https://github.com/weatherlayers/weatherlayers-gl) library for high-performance visualization.

#### User Interface

The component renders a slider as a map overlay. This slider allows the user to select an isobaric level (in hPa) and displays the corresponding approximate flight level (FL). When the user changes the slider's value, the component calls the `/weather/wind` backend endpoint.

#### Wind Field Rendering with Deck.gl

The rendering process leverages WebGL for smooth particle animation:

1. The backend API (`/weather/wind`) processes the GRIB file and returns the U and V wind components encoded as an RGBA PNG image (in a Base64 data URI), along with geographic bounds.
2. The frontend decodes this image data into a texture.
3. A `ParticleLayer` from `weatherlayers-gl` is created using this texture to visualize the wind flow with animated particles.
4. This Deck.gl layer is added to the map via the `tangramApi`.

### 3. Enabling the Plugin

To use the wind field layer, install the `tangram_weather` package and add it to the `plugins` list in your `tangram.toml`:

```toml
[core]
plugins = ["tangram_weather"]
```

After restarting `tangram`, the wind field widget will appear on the map. It may take a few moments to download the GRIB file the first time.

![Example of a wind field added on the map](../../screenshot/windfield.png)

!!! tip

    Note that the wind field that is displayed for `TRA6424` is consistent with the groundspeed and true airspeed measured by the aircraft: 30 m/s (displayed on the lower right corner of the map) roughly corresponds to 60 kts, which is compatible with the delta in the speed values in the plot. Also a higher ground speed value is observed when the aircraft is flying with a strong tail wind.
