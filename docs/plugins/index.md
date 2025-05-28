# Plugins

The tangram platform can be extended with plugins to enhance its functionality. Plugins can be developed for both the frontend and the backend.

- [Frontend plugins](frontend.md) are Vue.js components that can be dynamically loaded into the web application

- [Backend plugins](backend.md) are processes (e.g. in Python) that extend the backend functionality, and include data processing, analysis, and API endpoints

Examples of plugins:

- [Map data receivers](examples/sensors.md): display the sensors' positions on the map
- [Origin and destination city pair](examples/citypair.md): display the origin and destination airports of flights
- [Wind fields](examples/windfield.md): display the wind field on the map using the fastmeteo data
- [Contrails](examples/contrails.md): display the contrails on the map using the fastmeteo data
