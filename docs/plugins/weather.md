# Weather Plugin

The `tangram_weather` plugin provides API endpoints to serve meteorological data, enabling features like wind field visualization on the map.

## Overview

This plugin fetches weather prediction data from Meteo-France's ARPEGE model, processes it, and exposes it via a REST API. The data is provided as GRIB files, which are downloaded and parsed on the backend.

## How It Works

1. The plugin downloads GRIB files containing ARPEGE weather model predictions from the public [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/donnees-pnt-retention-14-jours/) repository. These files are cached locally in a temporary directory.

2. It registers a `/weather` router with the main FastAPI application. The key endpoint is `/weather/wind`.

3. When a request is made to `/weather/wind?isobaric=<level>`, the plugin:
    - Determines the latest available GRIB file for the current time.
    - Uses `xarray` and `cfgrib` to open the GRIB file.
    - Selects the U and V wind components for the specified isobaric pressure level (e.g., 300 hPa).
    - Returns the data as a JSON response.

4. The frontend `WindField.vue` component calls this endpoint.