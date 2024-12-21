<template>
    <l-geo-json v-if="geoJsonData" :geojson="geoJsonData">
    </l-geo-json>
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
    computed: {
    },
    async mounted() {
        const response = await fetch("http://localhost:8080/sensors");
        const sensors = await response.json();
        console.log(sensors);

        // Convert sensor data to GeoJSON format
        this.geoJsonData = {
            type: "FeatureCollection",
            features: Object.values(sensors).filter(sensor => sensor.aircraft_count > 0).map((sensor) => ({
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