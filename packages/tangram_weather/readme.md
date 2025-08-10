# Weather plugin

This plugin provides an API endpoint to fetch weather data from a third-party service. For now, files with predictions from the Meteo-France Arpege weather service are used, but it is also possible to use any weather service that provides an API.

Grib files are downloaded in the system temporary directory and then processed to extract the relevant data. The plugin provides an endpoint to fetch the weather data for specific spatio-temporal coordinates.
