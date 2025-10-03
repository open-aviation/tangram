# Origin and Destination

## Statement of need

The `tangram_jet1090` plugin includes a widget that displays the origin and destination information for a selected aircraft, showing both the airport ICAO codes and the city names. This makes it easy to quickly understand the flight's route without leaving the main map interface.

## Implementation

The city pair widget is part of the `AircraftInfoWidget.vue` component, which appears in the sidebar when an aircraft is selected.

It works as follows:

1. When an aircraft is selected, the widget uses the aircraft's callsign to make a request to the `/route/{callsign}` API endpoint.
2. This endpoint, provided by the `tangram_jet1090` backend plugin, proxies the request to the [OpenSky Network's route database](https://flightroutes.opensky-network.org).
3. If a route is found, the widget displays the origin and destination airport ICAO codes.
4. It then uses the [`rs1090-wasm` library](https://www.npmjs.com/package/rs1090-wasm) (bundled with `tangram` core) to look up and display the corresponding city names for each airport.

This functionality is self-contained within the `tangram_jet1090` plugin and requires no extra configuration beyond enabling the plugin itself.

![City Pair Plugin Example](../../screenshot/citypair.png)

!!! warning
    The OpenSky Network's route service is not guaranteed to be available for all aircraft. If no route information is found, the widget will display an appropriate message.
