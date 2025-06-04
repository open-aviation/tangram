# Map data receivers

## Statement of need

Mode S data is provided by the `jet1090` process, which decodes the data from aggregated various sources, such as software-defined radio devices or network streams. Each source of data corresponds to a different receiver, hence a different location.

It is useful to visualize the position of the receivers on the map, so that the user can see where the data is coming from. The position of the receivers is provided by the `jet1090` process, which can be configured to provide the position of the receivers in the `config_jet1090.toml` file.

See [Configuring jet1090](../configuration/jet1090.md) for more details.

## Implementation

The implementation of the map data receivers plugin is a Vue.js component that displays the positions of the receivers on the map. The implementation of this plugin is located in the `src/components/SensorsInfo.vue` file, i.e. in the default fallback location for plugins.

!!! tip

    When a Vue component is a plugin, its implementation can be overridden by a custom implementation located in a different directory. This is useful if you want to have several possible implementations for a functionality, or if you want to use a different implementation for a specific use case.

    If the environment variable `TANGRAM_WEB_SENSORSINFO_PLUGIN` is defined, the plugin will be loaded from the specified path. Otherwise, it will be loaded from the default `src/components/` directory.

The information to display is provided by the `tangram` REST API, which provides the list of receivers and their positions on the `/sensors` endpoint.

### 1. Declare the plugin in the `vite.config.js` file

In order to use the `SensorsInfo` component as a plugin, you need to declare it in the `vite.config.js` file. This allows the Vue application to dynamically load the component when needed.

```javascript
plugins: [
  // ..., other settings
  dynamicComponentsPlugin({
    envPath: "../.env",
    fallbackDir: "./src/components/",
    availablePlugins: ["sensorsInfo"], // list all your plugins here
  }),
],
```

### 2. Proxy the /sensors endpoint

In the `vite.config.js` file, you need to add a proxy configuration to redirect requests to the `/sensors` endpoint to the `tangram` REST API:

```javascript
server: {
  proxy: {
    // ..., other settings
    "/sensors": {
        target: `${jet1090_service}/sensors`,
        changeOrigin: true,
        secure: false,
    }
  },
```

This proxy rule is already implemented by default. It redirects requests to the `/sensors` endpoint to the `jet1090` service, which provides the list of receivers and their positions.

### 3. Implement the Vue component

A Vue component consists of a template, a script, and a style section. The template defines the HTML structure of the component, the script contains the logic, and the style section defines the CSS styles.

In this example, we do not need to define any styles, so we will only implement the template and the script sections.

In the template part, we add a `<l-geo-json>` ([Documentation](https://vue2-leaflet.netlify.app/components/LGeoJson.html)) component that will display the GeoJSON data of the receivers on the map.

```vue
<template>
  <div>
    <l-geo-json v-if="geoJsonData" :geojson="geoJsonData"></l-geo-json>
  </div>
</template>
```

In the script part, we will fetch the data from the `/sensors` endpoint, transform it in a GeoJSON structure and store it in a reactive variable. We will use the `fetch` API to get the data and handle it accordingly.

The fetch command happens in the `mounted` lifecycle hook, which is called when the component is mounted to the DOM, i.e. when the component is ready to be displayed (after the page is loaded).

```vue
<script>
import { LGeoJson } from "@vue-leaflet/vue-leaflet";

export default {
  name: "SensorLayer",
  components: {
    LGeoJson,
  },
  data() {
    // initialize the geoJSON data
    return {
      geoJsonData: null,
    };
  },
  async mounted() {
    // `/sensors` is served by jet1090, the proxy is coded in vite.config.js
    const response = await fetch("/sensors");
    const sensors = await response.json();
    // Convert sensor data to GeoJSON format
    this.geoJsonData = {
      type: "FeatureCollection",
      features: Object.values(sensors)
        // only display sensors seeing at least one aircraft
        .filter((sensor) => sensor.aircraft_count > 0)
        .map((sensor) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [sensor.reference.longitude, sensor.reference.latitude],
          },
          properties: {
            name: sensor.name,
            aircraft_count: sensor.aircraft_count,
          },
        })),
    };
  },
};
</script>
```

### 4. Refer to the component in the main application

In the `App.vue` file, use the `<plugin-sensorsinfo />` component to include the plugin in the main application. This will render the component and display the sensors' positions on the map.

!!! tip

    After you declared the plugin in the `vite.config.js` file, you can use the `<plugin-sensorsinfo />` component in any Vue file, not only in the `App.vue` file. The import will be done dynamically based on the environment variable `TANGRAM_WEB_SENSORSINFO_PLUGIN`.

### 5. Reload your application

Confirm the sensors are displayed on the map.
The reloading of the page should be dynamic, triggered everytime you save one of the critical files.
