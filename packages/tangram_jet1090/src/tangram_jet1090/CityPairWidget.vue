<template>
  <div v-if="routeInfo && routeInfo.origin && routeInfo.destination" class="city-pair">
    <div class="airport">
      <span class="icao">{{ routeInfo.origin.icao }}</span>
      <span class="city">{{ routeInfo.origin.city }}</span>
    </div>
    <div class="airport">
      <span class="icao">{{ routeInfo.destination.icao }}</span>
      <span class="city">{{ routeInfo.destination.city }}</span>
    </div>
  </div>
  <div v-else-if="loading" class="loading">Loading route information...</div>
  <div v-else-if="error" class="error">
    {{ error }}
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { airport_information } from "rs1090-wasm";
import { aircraftStore } from "./store";
import type { Jet1090Aircraft } from ".";

const props = defineProps<{
  icao24?: string;
}>();

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const targetId = computed(() => {
  if (props.icao24) return props.icao24;
  const active = tangramApi.state.activeEntities.value;
  if (active.size === 1) {
    const [id, entity] = active.entries().next().value;
    if (entity.type === "jet1090_aircraft") return id;
  }
  return null;
});

const routeInfo = computed(() => {
  if (!targetId.value) return null;
  return aircraftStore.selected.get(targetId.value)?.route;
});

const loading = ref(false);
const error = ref<string | null>(null);

const fetchRouteData = async (icao24: string, callsign: string) => {
  if (!callsign) return;
  const storeEntry = aircraftStore.selected.get(icao24);
  if (!storeEntry) return;

  // avoid re-fetching if already present
  if (storeEntry.route.origin && storeEntry.route.destination) return;

  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(`/jet1090/route/${callsign.trim()}`);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const data = await response.json();

    if (!data || data.length === 0) {
      error.value = "No route information available";
      return;
    }

    const route = data[0];
    if (route.plausible === 0 || route.airport_codes === "unknown") {
      error.value = "No route found for this flight";
      return;
    }

    const [originCode, destinationCode] = route.airport_codes.split("-");
    const originResults = airport_information(originCode);
    const destResults = airport_information(destinationCode);

    // check existence after async await
    const currentEntry = aircraftStore.selected.get(icao24);
    if (!currentEntry) return;

    if (originResults.length > 0) {
      const o = originResults[0];
      currentEntry.route.origin = {
        lat: o.lat,
        lon: o.lon,
        name: o.name,
        city: o.city,
        icao: o.icao
      };
    } else {
      currentEntry.route.origin = {
        lat: null,
        lon: null,
        name: originCode,
        city: originCode,
        icao: originCode
      };
    }

    if (destResults.length > 0) {
      const d = destResults[0];
      currentEntry.route.destination = {
        lat: d.lat,
        lon: d.lon,
        name: d.name,
        city: d.city,
        icao: d.icao
      };
    } else {
      currentEntry.route.destination = {
        lat: null,
        lon: null,
        name: destinationCode,
        city: destinationCode,
        icao: destinationCode
      };
    }
  } catch (err: unknown) {
    error.value = `Error: ${(err as Error).message}`;
  } finally {
    loading.value = false;
  }
};

watch(
  targetId,
  newId => {
    if (newId) {
      const entity = tangramApi.state.activeEntities.value.get(newId);
      const state = entity?.state as Jet1090Aircraft;
      if (state?.callsign) {
        fetchRouteData(newId, state.callsign);
      }
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.city-pair {
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
