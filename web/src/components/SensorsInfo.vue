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
        return {
            geoJsonData: null,
        };
    },
    computed: {},
    async mounted() {
        // `/sensors` is served by jet1090, we'll just let vite proxy it
        const response = await fetch("/sensors");
        const sensors = await response.json();
        // Convert sensor data to GeoJSON format
        this.geoJsonData = {
            type: "FeatureCollection",
            features: Object.values(sensors)
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
