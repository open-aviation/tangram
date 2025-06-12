<template>
    <div>
        <!-- This component doesn't have a visual template as it adds layers to parent map -->
        <div class="wind-altitude-control" @mousedown.stop @touchstart.stop>
            <label for="altitude-slider">{{ hPa }}hPa | FL{{ FL }}</label>

            <input id="altitude-slider" type="range" min="100" max="1000"
                @change="altitudeChanged" step="50" v-model="hPa">
        </div>
    </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet-velocity';
import 'leaflet-velocity/dist/leaflet-velocity.css';
import { useMapStore } from '../store';


export default {
    name: 'WindField',
    data() {
        return {
            windLayer: null,
            store: useMapStore(),
            hPa: 300, // Default altitude in hPa
            FL: 300, // Default flight level
        };
    },
    mounted() {
        this.initWindLayer();
    },
    beforeUnmount() {
        // Clean up when component is destroyed
        if (this.store.map && this.store.map.leafletObject) {
            // Remove the wind layer if it exists
            if (this.windLayer) {
                this.store.map.leafletObject.removeLayer(this.windLayer);
            }
        }
    },
    methods: {
        altitudeChanged() {
            // Handle altitude change
            console.log("Altitude changed to:", this.hPa);
            this.FL = this.hPaToFlightLevel(this.hPa);
            // Re-fetch wind data with new altitude
            this.fetchAndDisplayWindData();
        },
        hPaToFlightLevel(hPa) {
            // Constants for the ISA model
            const P0 = 1013.25; // Standard sea level pressure in hPa
            const T0 = 288.15;  // Standard sea level temperature in K
            const L = 0.0065;   // Temperature lapse rate in K/m
            const g = 9.80665;  // Gravitational acceleration in m/s²
            const R = 287.05;   // Specific gas constant for dry air in J/(kg·K)
            const H_TROP = 11000; // Height of tropopause in m

            let altitude;
            if (hPa > 226.32) { // Pressure at tropopause
                // Below tropopause - using barometric formula with temperature gradient
                altitude = T0 / L * (1 - Math.pow(hPa / P0, (L * R) / g));
            } else {
                // Above tropopause - isothermal layer
                const T_TROP = T0 - L * H_TROP; // Temperature at tropopause
                const P_TROP = P0 * Math.pow(T_TROP / T0, g / (L * R)); // Pressure at tropopause
                altitude = H_TROP + (T_TROP * R / g) * Math.log(P_TROP / hPa);
            }

            // Convert to flight level (hundreds of feet)
            return Math.round(altitude * 3.28084 / 1000) * 10;
        },
        async initWindLayer() {
            // Wait for the map to be initialized
            if (!this.store.map || !this.store.map.leafletObject) {
                // Set up a watcher to initialize when map becomes available
                const unwatch = this.$watch(
                    () => this.store.map?.leafletObject,
                    (newVal) => {
                        if (newVal) {
                            unwatch();

                            // Add listener for map movement to update wind field
                            this.fetchAndDisplayWindData();
                        }
                    },
                    { immediate: true }
                );
                return;
            }

            // If map is already available, set up the listener
            // Usually, this will not be the case, but it happens
            await this.fetchAndDisplayWindData();
        },


        async fetchAndDisplayWindData() {
            // Check if map is available
            if (!this.store.map || !this.store.map.leafletObject) {
                console.error("Map not available");
                return;
            }

            // Fetch wind data from API
            const response = await fetch(`/weather/wind?isobaric=${this.hPa}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Format data for leaflet-velocity
            const velocityData = this.formatDataForVelocity(data);

            if (this.windLayer !== null) {
                this.windLayer.setData(velocityData);
                return;
            }

            // Create and add new wind layer
            const windLayer = L.velocityLayer({
                displayValues: true,
                displayOptions: {
                    velocityType: 'Wind',
                    position: 'bottomleft',
                    emptyString: 'No wind data',
                    angleConvention: 'bearingCW',
                    displayPosition: 'bottomleft',
                    displayEmptyString: 'No wind data',
                    speedUnit: 'ms'
                },
                data: velocityData,
                minVelocity: 0,
                maxVelocity: 100,
                velocityScale: 0.01, // Adjust this value based on your data scale
                colorScale: [
                    '#3288bd',     // Light blue for very light winds
                    '#66c2a5',   // Teal for light winds
                    '#abdda4',   // Light green for moderate-light winds
                    '#e6f598',   // Lime for moderate winds
                    '#fee08b',   // Light orange for moderate-strong winds
                    '#fdae61',   // Orange for strong winds
                    '#f46d43',   // Red-orange for very strong winds
                    '#d53e4f'      // Dark red for extremely strong winds
                ],
            });
            windLayer.addTo(this.store.map.leafletObject);
            this.windLayer = windLayer;
        },

        formatDataForVelocity(rawData) {
            // Format the API response into the structure required by leaflet-velocity
            // The exact structure depends on your API, but typical format is:
            const formattedData = [
                {
                    header: {
                        parameterCategory: 2,
                        parameterNumber: 2,
                        dx: rawData.data_vars.u.attrs.GRIB_iDirectionIncrementInDegrees,
                        dy: rawData.data_vars.u.attrs.GRIB_jDirectionIncrementInDegrees,
                        la1: rawData.data_vars.u.attrs.GRIB_latitudeOfFirstGridPointInDegrees,
                        lo1: rawData.data_vars.u.attrs.GRIB_longitudeOfFirstGridPointInDegrees,
                        la2: rawData.data_vars.u.attrs.GRIB_latitudeOfLastGridPointInDegrees,
                        lo2: rawData.data_vars.u.attrs.GRIB_longitudeOfLastGridPointInDegrees,
                        nx: rawData.data_vars.u.attrs.GRIB_Nx,
                        ny: rawData.data_vars.u.attrs.GRIB_Ny,
                        refTime: new Date().toISOString()
                    },
                    data: rawData.data_vars.u.data.flat(),
                },
                {
                    header: {
                        parameterCategory: 2,
                        parameterNumber: 3,
                        dx: rawData.data_vars.v.attrs.GRIB_iDirectionIncrementInDegrees,
                        dy: rawData.data_vars.v.attrs.GRIB_jDirectionIncrementInDegrees,
                        la1: rawData.data_vars.v.attrs.GRIB_latitudeOfFirstGridPointInDegrees,
                        lo1: rawData.data_vars.v.attrs.GRIB_longitudeOfFirstGridPointInDegrees,
                        la2: rawData.data_vars.v.attrs.GRIB_latitudeOfLastGridPointInDegrees,
                        lo2: rawData.data_vars.v.attrs.GRIB_longitudeOfLastGridPointInDegrees,
                        nx: rawData.data_vars.v.attrs.GRIB_Nx,
                        ny: rawData.data_vars.v.attrs.GRIB_Ny,
                        refTime: new Date().toISOString()
                    },
                    data: rawData.data_vars.v.data.flat()
                }
            ];
            return formattedData;
        }
    }
};
</script>

<style scoped>
.wind-altitude-control {
    position: absolute;
    bottom: 20px;
    right: 70px;
    background: rgba(255, 255, 255, 0.8);
    padding: 10px;
    border-radius: 5px;
    z-index: 1000;
}

.wind-altitude-control label {
    font-family: "B612", sans-serif;
    font-size: 12px;
}

input[type="range"] {
    cursor: pointer;
    width: 100%;
    margin-top: 5px;
    background: #bab0ac;
    height: 2px;
    border-radius: 5px;
}

.leaflet-control-velocity {
    width: 200px;
}
</style>
