# Airports Plugin

The `tangram_airports` plugin adds an airport search widget as an overlay on the top-right corner of the map. This allows users to quickly find and center the map on any airport by name, IATA code, or ICAO code.

## How It Works

This is a frontend-only plugin that requires no additional backend configuration.

1. It registers a Vue component, `AirportSearchWidget.vue`, in the `MapOverlay` location of the UI.
2. The component uses the `rs1090-wasm` library, which is bundled with the core `tangram` application, to perform a fast, client-side search of a comprehensive airport database.
3. When a user selects an airport from the search results, the plugin uses the `MapApi` to pan and zoom the map to the airport's location.

## Configuration

To enable this plugin, add `"tangram_airports"` to the `plugins` list in your `tangram.toml` file:
