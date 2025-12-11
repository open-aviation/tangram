<template>
  <div class="airport-search">
    <input
      v-model="query"
      type="text"
      placeholder="Search for airports..."
      @click="($event.target as HTMLInputElement).select()"
      @input="onInput"
    />
    <ul v-if="results.length" class="search-results">
      <li
        v-for="airport in results"
        :key="airport.icao"
        @click="selectAirport(airport)"
      >
        {{ airport.name }} ({{ airport.iata }} | {{ airport.icao }})
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, inject } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { airport_information } from "rs1090-wasm";

interface Airport {
  lat: number;
  lon: number;
  name: string;
  iata: string;
  icao: string;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}
const query = ref("");
const results = ref<Airport[]>([]);
const timeoutId = ref<number | null>(null);

const onInput = () => {
  if (timeoutId.value) {
    clearTimeout(timeoutId.value);
  }
  if (query.value.length >= 3) {
    timeoutId.value = window.setTimeout(() => {
      searchAirports();
    }, 300);
  } else {
    results.value = [];
  }
};

const searchAirports = () => {
  results.value = airport_information(query.value);
};

const selectAirport = (airport: Airport) => {
  tangramApi.map.getMapInstance().flyTo({
    center: [airport.lon, airport.lat],
    zoom: 13,
    speed: 1.2
  });
  query.value = "";
  results.value = [];
};
</script>

<style scoped>
.airport-search {
  position: absolute;
  width: 300px;
  z-index: 1000;
  top: 10px;
  right: 10px;
}

.airport-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 10px;
  font-family: "B612", sans-serif;
  box-sizing: border-box;
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
  z-index: 1001;
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
