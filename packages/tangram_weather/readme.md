# Weather plugin

This plugin provides an API endpoint to fetch weather data from a third-party service. For now, files with predictions from the Meteo-France Arpege weather service are used, but it is also possible to use any weather service that provides an API.

Grib files are downloaded in the system temporary directory and then processed to extract the relevant data. The plugin provides an endpoint to fetch the weather data for specific spatio-temporal coordinates.

## About Tangram

`tangram_weather` is a plugin for `tangram`, an open framework for modular, real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-weather tangram-core
# with pip
pip install tangram-core tangram-weather
```
