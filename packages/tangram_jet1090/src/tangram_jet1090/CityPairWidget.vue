<template>
  <div v-if="state.origin && state.destination" id="city_pair">
    <div class="airport">
      <span class="icao">{{ state.origin }}</span>
      <span class="city">{{ state.originName }}</span>
    </div>
    <div class="airport">
      <span class="icao">{{ state.destination }}</span>
      <span class="city">{{ state.destinationName }}</span>
    </div>
  </div>
  <div v-else-if="state.loading" class="loading">Loading route information...</div>
  <div v-else-if="state.error" class="error">
    {{ state.error }}
  </div>
</template>

<script setup lang="ts">
import { inject, reactive, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";
import { airport_information } from "rs1090-wasm";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const state = reactive({
  loading: false,
  error: null as string | null,
  origin: null as string | null,
  destination: null as string | null,
  originName: null as string | null,
  destinationName: null as string | null
});

const resetData = () => {
  state.origin = null;
  state.destination = null;
  state.originName = null;
  state.destinationName = null;
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

    const [origin, destination] = route.airport_codes.split("-");
    state.origin = origin;
    state.destination = destination;

    const originInfo = airport_information(origin);
    state.originName = originInfo.length > 0 ? originInfo[0].city : origin;

    const destinationInfo = airport_information(destination);
    state.destinationName =
      destinationInfo.length > 0 ? destinationInfo[0].city : destination;
  } catch (err: any) {
    state.error = `Error: ${err.message}`;
  } finally {
    state.loading = false;
  }
};

watch(
  () => tangramApi.state.activeEntity?.id,
  newId => {
    resetData();
    if (newId) {
      const activeEntity = tangramApi.state.activeEntity;
      const callsign = (activeEntity?.state as any)?.callsign;
      if (callsign) {
        fetchRouteData(callsign);
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
}
</style>
