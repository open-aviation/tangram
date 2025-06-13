# Add a wind field layer

## Statement of need

Meteorological data is essential for understanding the impact of weather on aviation operations. Meteo France provides weather prediction data from their [ARPEGE model](https://meteofrance.com/actualites-et-dossiers/modeles-prevision-meteo). The most basic features include zonal and meridional wind components, but also temperature, pressure, and humidity. More advanced features are also available but we will not cover them here.

A [web API](https://portail-api.meteofrance.fr/web/en/api/ARPEGE) is available after registration, but we will prefer here the GRIB files that can also be downloaded directly from the [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/donnees-pnt-retention-14-jours/) initiative, also provided by Meteo France under an Open License.

New predictions are published every 6 hours, and the data is available for 3 days in advance. The data is provided in GRIB format, which is a standard format for meteorological data. In each file, each grid point represents spatio-temporal coordinates, and the data is provided for each hour of the day. The data is available at a resolution of 0.1 degrees, which is approximately 11 km at the equator. Altitude is provided in isobars, which is a standard unit for atmospheric pressure.

## Implementation

The objective of this plugin is to display a wind field on the map, at an isobar specified by the user. We need to work on the following steps:

1. on the backend side, download the GRIB files from the data.gouv.fr initiative, and provide an API endpoint to fetch the wind field data for a specific isobar
2. on the frontend side, create a Vue component that will display a slider to select an isobar, and display the corresponding wind field on the map.

### 1. Implement a backend plugin for wind information

Create a `weather` folder in the `src/tangram/plugins/` directory, and register the plugin in the `__init__.py` file. The plugin, associated with the `/weather` router will provide an API endpoint to fetch the wind field data for a specific isobar.

The logic for downloading the data is implemented in the `arpege.py` file.

The code is self-explanatory, but the following points are worth noting:

- in `__init__.py`, the `wind(isobaric: int)` function returns a `ORJSONResponse` (from `fastapi.responses`) rather than a `JSONResponse`. This is because the data is large and we want to avoid the overhead of converting it to JSON. The `ORJSONResponse` is a faster alternative, based on [**`orjson`**](https://github.com/ijl/orjson) that can handle large data efficiently. It also automatically deals with datetime objects, which are used in the GRIB data.

!!! tip

    Extra Python libraries can be included with the `uv add` command.

    The command edits both the `pyproject.toml` and the `uv.lock` files:

    ```shell
    uv add xarray cfgrib orjson
    ```

- in `arpege.py`, the download of the GRIB file is wrapped in a try/except block. If the file is not found (or Internet is momentarily unavailable), the function will try to get the previous file (6 hours before) and return it. It can be useful to fallback to older files when the newer versions are not yet available.

- the `xarray` library offers a `load_dataset` and an `open_dataset` function to read GRIB files. The `open_dataset` function is used here, as it allows to read the file without loading it entirely into memory, which is useful for large files.

!!! warning

    There is an issue with the packaging of the `ecCodes` library that is used by `xarray` to read GRIB files. The specific version of the `ecCodes` library for Linux/arm64 is not yet available at the time of writing this documentation.

    **You are most likely to be impacted by this issue if you run this plugin on Apple Silicon Mac computers.**
    In that case, you may want to run `just create-tangram-aarch64` to create a new Docker image with the latest version of the `ecCodes` library. The `just tangram` command will then use this image to run the application.

### 2. Declare the plugin in the vite.config.js file

The backend part of the plugin does not require any specific declaration or configuration. The frontend part will be implemented as a Vue component, which will be dynamically loaded after being declared in the `vite.config.js` file.

```javascript
plugins: [
  // ..., other settings
  dynamicComponentsPlugin({
    envPath: "../.env",
    fallbackDir: "./src/components/",
    availablePlugins: [
        "airportSearch",
        "systemInfo",
        "sensorsInfo",
        "windfield",  // <-- new line
    ],
  }),
],
```

### 3. Implement the Vue component

The Vue component will be implemented in the `src/components/WindField.vue` file. The component will include a slider to select the isobaric level, and build the JavaScript structure required to create the wind field.

The template part of the component will include the slider, which is bound to a `v-model` variable called `isobaric`. The slider allows the user to select an isobaric level between 100 and 1000 hPa, with a step of 50 hPa.

```vue
<template>
  <div class="wind-altitude-control" @mousedown.stop @touchstart.stop>
    <label for="hpa-slider">{{ isobaric }}hPa | FL{{ FL }}</label>
    <!-- @input is for the slider is moved, @change when the mouse is released -->
    <input
      id="hpa-slider"
      type="range"
      min="100"
      max="1000"
      @input="updateLabel"
      @change="updateValue"
      step="50"
      v-model="isobaric"
    />
  </div>
</template>
```

The `<input>` element is mapped to two events: `@input` and `@change`. The `@input` event is triggered when the user moves the slider, and it updates the `isobaric` variable, together with a conversion in altitude (in flight levels, i.e. hundreds of feet. FL100 corresponds to 10,000 ft).

```javascript
import { useMapStore } from "../store"; // Import the map store

export default {
  name: "WindField",
  data() {
    return {
      velocityLayer: null, // This will hold the Leaflet Velocity layer
      store: useMapStore(),
      isobaric: 300, // Default value in hPa (FL300)
      FL: 300, // Default value in flight level
    };
  },
  methods: {
    updateLabel() {
      // this method is available in the WindField.vue component
      this.FL = this.convertHpaToFlightLevel(this.isobaric);
    },
    async updateValue() {
      console.log("Altitude changed to:", this.isobaric, "hPa");
      // Fetch the wind field data for the selected isobaric level
      this.fetchAndDisplay();
    },
  },
};
```

The `@change` event is triggered when the user releases the slider, and it calls the `updateValue` method to fetch the wind field data for the selected isobaric level. The default value of the slides is set to 300hPa (FL300), which is a common altitude for commercial flights.

The style section of the component is at the end of the file, with a `scoped` attribute to limit the styles to this component only.

```vue
<style scoped>
.wind-altitude-control {
  /* this specifies the positioning of the slider on the map */
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
  padding: 10px;
  border-radius: 5px;
}
/* more items */
</style>
```

### 4. Implement the velocity field

!!! warning

    The Leaflet Velocity plugin is not available as a vue component, only as a regular JavaScript library. Therefore, a little more work is required to integrate it into the Vue component.

Installing a new JavaScript library in a Vue component is done by importing the library in the script section of the component.

- First, it needs to be installed in the project with npm:

  ```shell
  npm install leaflet-velocity  # from the web folder
  ```

- Then it needs to be imported in the `WindField.vue` component:

  ```javascript
  import L from "leaflet";
  import "leaflet-velocity";
  import "leaflet-velocity/dist/leaflet-velocity.min.css";
  ```

Then the difficulty will be due to the fact that the Leaflet Velocity plugin is not a Vue component, but a regular JavaScript library. Therefore, we need to create a method that will be called when the component is mounted, and which will create the velocity field on the map.

It can only be attached to the map after the map is created, so we will use the `mounted` lifecycle hook of the Vue component, and set up a watch to initialize the wind field only after the map becomes available.

The main Leaflet map object is available from the `store` (the structure used to share information between components) as `this.store.map.leafletObject`.

```javascript
    mounted() {
        // Wait for the map to be initialized
        if (!this.store.map || !this.store.map.leafletObject) {
            // Set up a watcher to initialize when map becomes available
            const unwatch = this.$watch(
                () => this.store.map?.leafletObject,
                (newVal) => {
                    if (newVal) {
                        unwatch();
                        this.fetchAndDisplay();
                    }
                },
                { immediate: true }
            );
            return;
        }

        // If map is already available, just load the data
        this.fetchAndDisplay();

    },
```

Then, the `fetchAndDisplay` method will be called to fetch the wind field data from the backend and display it on the map.

```javascript
    async fetchAndDisplay() {
        const response = await fetch(`/weather/wind?isobaric=${this.isobaric}`);
        if (!response.ok) {
            console.error("Failed to fetch wind field data:", response.statusText);
            return;
        }
        const data = await response.json();

        // Create a velocity layer with the fetched data
        const velocityLayer = L.velocityLayer({
           ... // to be filled
        });

        // Add the velocity layer to the map
        this.store.map.leafletObject.addLayer(velocityLayer);
    },
```

### 5. Refer to the components in the main application

In the `App.vue` file, use the `<plugin-windfield />` component to include the plugin in the main application. This will render the component and display the slider to select the isobaric level, and also render the wind field on the map after receiving the appropriate data from the backend.

### 6. Reload the application

Confirm the windfield is displayed on the map. It may take a few minutes to first download the GRIB file, so be patient. Once it is downloaded in the /tmp directory, it will be reused for subsequent requests. When the container is switched off, the GRIB file will be deleted, so it will need to be downloaded again on the next run.

![Example of a wind field added on the map](../../screenshot/windfield.png)

!!! tip

    Note that the wind field that is displayed for `TRA6424` is consistent with the groundspeed and true airspeed measured by the aircraft: 30 m/s (displayed on the lower right corner of the map) roughly corresponds to 60 kts, which is compatible with the delta in the speed values in the plot. Also a higher ground speed value is observed when the aircraft is flying with a strong tail wind.
