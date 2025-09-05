<template>
    <div id="city_pair" v-if="origin && destination">
        <div class="airport">
            <span class="icao">{{ origin }}</span>
            <span class="city">{{ originName }}</span>
        </div>
        <div class="airport">
            <span class="icao">{{ destination }}</span>
            <span class="city">{{ destinationName }}</span>
        </div>
    </div>
    <div v-else-if="loading" class="loading">
        Loading route information...
    </div>
    <div v-else-if="error" class="error">
        {{ error }}
    </div>
</template>

<script>
import { useMapStore } from '@store';
import { airport_information } from 'rs1090-wasm';

export default {
    data() {
        return {
            store: useMapStore(),
            loading: false,
            error: null,
            origin: null,
            destination: null,
            originName: null,
            destinationName: null
        }
    },
    computed: {
        selected() {
            return this.store.selectedPlane
        }
    },
    watch: {
        selected: {
            deep: true,
            immediate: true,
            handler(newValue) {
                this.resetData();
                if (newValue && newValue.callsign) {
                    this.fetchRouteData(newValue.callsign.trim());
                }
            }
        }
    },
    methods: {
        resetData() {
            this.origin = null;
            this.destination = null;
            this.originName = null;
            this.destinationName = null;
            this.error = null;
        },
        fetchRouteData(callsign) {
            if (!callsign) {
                this.resetData();
                return;
            }

            this.loading = true;
            this.error = null;

            fetch('/route', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    planes: [{ callsign }]
                })
            })
                .then(response => {
                    console.log("Response status:", response.status);
                    console.log("Response headers:", response.headers);

                    if (!response.ok) {
                        throw new Error(`API request failed with status ${response.status}`);
                    }
                    return response.json().catch(err => {
                        console.error("JSON parse error:", err);
                        throw new Error("Invalid response format");
                    });
                })
                .then(data => {
                    this.loading = false;

                    if (!data || data.length === 0) {
                        this.error = "No route information available";
                        return;
                    }

                    const route = data[0];

                    if (route.plausible === 0 || route.airport_codes === "unknown") {
                        this.error = "No route found for this flight";
                        return;
                    }

                    const [origin, destination] = route.airport_codes.split('-');
                    this.origin = origin;
                    this.destination = destination;

                    try {
                        const originInfo = airport_information(origin);
                        this.originName = originInfo.length > 0 ? originInfo[0].city : origin;

                        const destinationInfo = airport_information(destination);
                        this.destinationName = destinationInfo.length > 0 ? destinationInfo[0].city : destination;
                    } catch (e) {
                        console.error("Error fetching airport information:", e);
                        this.originName = origin;
                        this.destinationName = destination;
                    }
                })
                .catch(err => {
                    this.loading = false;
                    this.error = `Error: ${err.message}`;
                    console.error("Error fetching route data:", err);
                });
        }
    }
}
</script>

<style scoped>
#city_pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    clear: both;
    margin-bottom: 5px;
}

.airport {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.airport .icao {
    font-size: 15pt;
}

.airport .city {
    font-family: "Roboto Condensed", sans-serif;
    color: #79706e;
    font-size: 10pt;
}

.loading,
.error {
    text-align: center;
    padding: 10px;
    color: #79706e;
}
</style>
