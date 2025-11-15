<template>
  <div
    v-if="activeEntity && activeEntity.type === 'ship162_ship' && ship"
    class="ship-info-widget"
  >
    <div id="metadata">
      <span v-if="ship.ship_type" id="shiptype"> {{ ship.ship_type }}</span>
      <span>{{ ship.ship_name || "N/A" }}</span>
      <span id="mmsi">{{ ship.mmsi }}</span
      ><br />
      <span v-if="flag" id="registration">
        {{ flag }} {{ ship.mmsi_info?.country?.country }}
      </span>
    </div>

    <table class="details">
      <tr v-if="ship.callsign">
        <td class="label">Callsign:</td>
        <td>{{ ship.callsign }}</td>
      </tr>
      <tr v-if="ship.imo">
        <td class="label">IMO:</td>
        <td>{{ ship.imo }}</td>
      </tr>
      <tr v-if="ship.status">
        <td class="label">Status:</td>
        <td>{{ ship.status }}</td>
      </tr>
      <tr v-if="ship.destination">
        <td class="label">Destination:</td>
        <td>{{ ship.destination }}</td>
      </tr>
      <tr>
        <td class="label">Position:</td>
        <td>{{ ship.latitude?.toFixed(4) }}, {{ ship.longitude?.toFixed(4) }}</td>
      </tr>
      <tr v-if="ship.speed">
        <td class="label">Speed:</td>
        <td>{{ ship.speed.toFixed(1) }} kts</td>
      </tr>
      <tr v-if="ship.course">
        <td class="label">Course:</td>
        <td>{{ ship.course.toFixed(0) }}°</td>
      </tr>
      <tr v-if="ship.heading">
        <td class="label">Heading:</td>
        <td>{{ ship.heading.toFixed(0) }}°</td>
      </tr>
      <tr v-if="ship.turn">
        <td class="label">Rate of Turn:</td>
        <td>{{ ship.turn.toFixed(1) }}°/min</td>
      </tr>
      <tr v-if="ship.draught">
        <td class="label">Draught:</td>
        <td>{{ ship.draught.toFixed(1) }} m</td>
      </tr>
      <tr v-if="dimensions">
        <td class="label">Dimensions:</td>
        <td>{{ dimensions }} m</td>
      </tr>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";
import type { ShipState } from "./ShipLayer.vue";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}
const activeEntity = tangramApi.state.activeEntity;
const ship = computed(() => activeEntity.value?.state as ShipState | null);
const flag = computed(() => ship.value?.mmsi_info?.country?.flag || "");

const dimensions = computed(() => {
  if (!ship.value) return null;
  const { to_bow, to_stern, to_port, to_starboard } = ship.value;
  if (to_bow != null && to_stern != null && to_port != null && to_starboard != null) {
    const length = to_bow + to_stern;
    const width = to_port + to_starboard;
    if (length > 0 || width > 0) {
      return `${length} x ${width}`;
    }
  }
  return null;
});
</script>

<style scoped>
.ship-info-widget {
  padding: 10px;
  font-size: 12px;
}
#metadata {
  margin-bottom: 10px;
}
#registration {
  font-size: 10pt;
}
#mmsi {
  font-family: "Inconsolata", monospace;
  float: right;
  margin-right: 3px;
  border: 1px solid #f2cf5b;
  border-radius: 5px;
  background-color: #f2cf5b;
  padding: 2px 5px;
  font-size: 10pt;
}
#shiptype {
  border: 1px solid #4c78a8;
  background-color: #4c78a8;
  color: white;
  border-radius: 5px;
  padding: 2px 5px;
  font-family: "Roboto Condensed", sans-serif;
  font-size: 10pt;
  float: right;
  margin-left: 5px;
}
.details {
  border-collapse: collapse;
  margin-bottom: 1rem;
  width: 100%;
}
.details td {
  padding: 2px 0;
  border: none;
}
.details .label {
  text-align: right;
  font-weight: bold;
  padding-right: 8px;
  white-space: nowrap;
  width: 1%;
}

h5 {
  margin: 0.5rem 0 1rem 0;
  padding-top: 0.25rem;
  border-top: solid 1px #bab0ac;
  font-family: "Roboto Condensed", sans-serif;
  font-weight: 500;
  font-size: 1.3rem;
}
</style>