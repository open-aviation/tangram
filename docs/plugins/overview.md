# Plugins

`tangram` is designed to be extended with plugins. This modular approach allows you to tailor the system to your specific needs, whether you are working with real-world ADS-B data, simulation outputs, or other data sources.

Plugins are developed as standalone packages, enabling them to be versioned, tested, and distributed independently.

- **[Backend Plugins](backend.md)** are installable Python packages that extend the server's functionality, typically by adding new API endpoints or background data processing services.
- **[Frontend plugins](frontend.md)** add Vue components, Deck.gl layers, importers, search providers, and other browser-side behavior. Their source uses npm dependencies, but the built assets are normally distributed inside the Python wheel.

A plugin may provide backend code, frontend assets, or both. Bundling both sides in one Python package gives users one installable, versioned feature.

## Official Plugins as Examples

The best way to learn how to build plugins is to study the official ones:

- `tangram_example`: A minimal template demonstrating both backend and frontend plugin structure.
- [`tangram_system`](./system.md): A simple plugin that adds a background service.
- [`tangram_jet1090`](./jet1090.md): A complex plugin that adds API routes, a background service for real-time data, and a historical trajectory API.
- [`tangram_weather`](./weather.md): A plugin that adds a new API endpoint for external data.
