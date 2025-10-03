# Data Receiver Map Layer

## Statement of need

Mode S data is provided by one or more `jet1090` processes, which decode data from various sources like software-defined radios or network streams. Each source corresponds to a receiver at a specific location.

The `tangram_jet1090` plugin provides a map layer to visualize the positions of these receivers, allowing users to see where their data is coming from.

## Implementation

The implementation is a Vue component, `SensorsLayer.vue`, which is registered as a map overlay by the `tangram_jet1090` frontend plugin.

1. When the map is initialized, the component fetches a list of sensors from the `/sensors` API endpoint.
2. This endpoint, provided by the `tangram_jet1090` backend, proxies the request to the configured `jet1090` service. The sensor information must be configured within the `jet1090` instance itself. See the [jet1090 configuration guide](https://mode-s.org/jet1090/config/) for details.
3. The component then converts the sensor data into a GeoJSON `FeatureCollection`.
4. Finally, it uses Leaflet's `L.geoJSON` to render the sensor locations as points on the map, with a tooltip showing the sensor's name and the number of aircraft it is currently tracking.
