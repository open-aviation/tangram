# Plugins

`tangram` is designed to be extended with plugins. This modular approach allows you to tailor the system to your specific needs, whether you are working with real-world ADS-B data, simulation outputs, or other data sources.

Plugins are developed as standalone packages, enabling them to be versioned, tested, and distributed independently.

-   [Backend Plugins](backend.md) are installable Python packages that extend the server's functionality, typically by adding new API endpoints or data processing workers.

-   [Frontend Plugins](frontend.md) are installable NPM packages that add new Vue.js components and widgets to the web interface.

Examples of plugins:

- [Map data receivers](examples/sensors.md): display the sensors' positions on the map
- [Wind fields](examples/windfield.md): display the wind field on the map using weather prediction data
- [Origin and destination city pair](examples/citypair.md): display the origin and destination airports of flights
- [Contrails](examples/contrails.md): display the contrails on the map using weather prediction data
