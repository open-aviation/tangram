<template>
  <div
    v-if="selectedAircraft.route.origin && selectedAircraft.route.destination"
    id="city_pair"
  >
    <div class="airport">
      <span class="icao">{{ selectedAircraft.route.origin.icao }}</span>
      <span class="city">{{ selectedAircraft.route.origin.city }}</span>
    </div>
    <div class="airport">
      <span class="icao">{{ selectedAircraft.route.destination.icao }}</span>
      <span class="city">{{ selectedAircraft.route.destination.city }}</span>
    </div>
  </div>
  <div v-else-if="state.loading" class="loading">Loading route information...</div>
  <div v-else-if="state.error" class="error">
    {{ state.error }}
  </div>
</template>

<script setup lang="ts">
import { inject, reactive, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { airport_information } from "rs1090-wasm";
import { selectedAircraft } from "./store";
import type { Jet1090Aircraft } from ".";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const state = reactive({
  loading: false,
  error: null as string | null
});

const resetData = () => {
  selectedAircraft.route.origin = null;
  selectedAircraft.route.destination = null;
  state.error = null;
  state.loading = false;
};

const fetchRouteData = async (callsign: string) => {
  if (!callsign) {
    resetData();
    return;
  }

  state.loading = true;
  state.error = null;

  try {
    const response = await fetch(`/jet1090/route/${callsign.trim()}`);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const data = await response.json();

    if (!data || data.length === 0) {
      state.error = "No route information available";
      return;
    }

    const route = data[0];
    if (route.plausible === 0 || route.airport_codes === "unknown") {
      state.error = "No route found for this flight";
      return;
    }

    const [originCode, destinationCode] = route.airport_codes.split("-");

    const originResults = airport_information(originCode);
    const destResults = airport_information(destinationCode);

    if (originResults.length > 0) {
      const o = originResults[0];
      selectedAircraft.route.origin = {
        lat: o.lat,
        lon: o.lon,
        name: o.name,
        city: o.city,
        icao: o.icao
      };
    } else {
      selectedAircraft.route.origin = {
        lat: null,
        lon: null,
        name: originCode,
        city: originCode,
        icao: originCode
      };
    }

    if (destResults.length > 0) {
      const d = destResults[0];
      selectedAircraft.route.destination = {
        lat: d.lat,
        lon: d.lon,
        name: d.name,
        city: d.city,
        icao: d.icao
      };
    } else {
      selectedAircraft.route.destination = {
        lat: null,
        lon: null,
        name: destinationCode,
        city: destinationCode,
        icao: destinationCode
      };
    }
  } catch (err: unknown) {
    state.error = `Error: ${(err as Error).message}`;
  } finally {
    state.loading = false;
  }
};

watch(
  () => tangramApi.state.activeEntity?.value?.id,
  newId => {
    resetData();
    if (newId) {
      const activeEntity = tangramApi.state.activeEntity.value;
      if (activeEntity?.type === "jet1090_aircraft") {
        const state = activeEntity.state as Jet1090Aircraft;
        if (state.callsign) {
          fetchRouteData(state.callsign);
        }
      }
    }
  },
  { immediate: true }
);
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
  font-size: 0.9em;
}
</style>
