<template>
    <div class="airport-search">
        <input v-model="query" type="text" placeholder="Search for airports..."
            @click="$event.target.select()" @input="onInput" />
        <ul v-if="results.length" class="search-results">
            <li v-for="airport in results" :key="airport.id"
                @click="selectAirport(airport)">
                {{ airport.name }} ({{ airport.iata }} | {{ airport.icao }})
            </li>
        </ul>
    </div>
</template>

<script>
import { airport_information } from 'rs1090-wasm';
import { useMapStore } from '../store';

export default {
    name: 'AirportSearch',
    data() {
        return {
            query: "",
            results: [],
            store: useMapStore(),
            timeoutId: null
        }
    },
    methods: {
        onInput() {
            clearTimeout(this.timeoutId);
            if (this.query.length >= 3) {
                // Debounce the search by 300ms.
                this.timeoutId = setTimeout(() => {
                    this.searchAirports();
                }, 300);
            } else {
                // Clear results if fewer than 3 letters.
                this.results = [];
            }
        },
        searchAirports() {
            this.results = airport_information(this.query);
        },
        selectAirport(airport) {
            // Emit an event with the selected airport details.
            // Parent component should listen to 'airport-selected' to center the map.
            //this.$emit('airport-selected', airport);
            this.store.map.leafletObject.setView(
                [airport.lat, airport.lon],
                13 // Adjust zoom level as needed
            );
            // Optionally update the query and clear results.
            this.query = ""; //airport.name;
            this.results = [];
        }
    }
}
</script>

<style scoped>
.airport-search {
    position: absolute;
    width: 300px;
    z-index: 1000;
    top: 15px;
    right: 10px;
}

.airport-search input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: "B612", sans-serif;
}

.search-results {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    padding: 0;
    margin: 4px 0 0 0;
    list-style: none;
    background: #fff;
    border: 1px solid #ccc;
    z-index: 1000;
    max-height: 200px;
    overflow-y: auto;
    font-family: "B612", sans-serif;
}

.search-results li {
    padding: 5px 10px;
    cursor: pointer;
}

.search-results li:hover {
    background-color: #eee;
}
</style>
