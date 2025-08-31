# Plugins

`tangram` is designed to be extended with plugins. This modular approach allows you to tailor the system to your specific needs, whether you are working with real-world ADS-B data, simulation outputs, or other data sources.

Plugins are developed as standalone packages, enabling them to be versioned, tested, and distributed independently.

- **[Backend Plugins](backend.md)** are installable Python packages that extend the server's functionality, typically by adding new API endpoints or background data processing services.
- **[Frontend Plugins](frontend.md)** are installable NPM packages that add new Vue.js components and widgets to the web interface.

A single Python package can provide both backend and frontend components by bundling the pre-built frontend assets within its wheel distribution. This is the recommended approach for creating a cohesive feature.

## Official Plugins as Examples

The best way to learn how to build plugins is to study the official ones:

- `tangram_example`: A minimal template demonstrating both backend and frontend plugin structure.
- [`tangram_system`](./system.md): A simple plugin that adds a background service.
- [`tangram_jet1090`](./jet1090.md): A complex plugin that adds API routes, a background service, and depends on an external data source.
- [`tangram_weather`](./weather.md): A plugin that adds a new API endpoint for external data.