<template>
    <div>
        <l-geo-json v-if="geoJsonData" :geojson="geoJsonData"></l-geo-json>
    </div>
</template>

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
                .filter(sensor => sensor.aircraft_count > 0)
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
