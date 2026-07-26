<template>
  <div v-if="point" class="details-grid">
    <span>name</span><strong>{{ point.name || point.ident }}</strong>
    <span>coordinates</span><strong>{{ coordinates }}</strong>
    <template v-if="point.frequency !== null">
      <span>frequency</span><strong>{{ point.frequency }}</strong>
    </template>
    <template v-if="point.elevationFt !== null">
      <span>elevation</span><strong>{{ Math.round(point.elevationFt) }} ft</strong>
    </template>
    <template v-if="point.source">
      <span>source</span><strong>{{ point.source }}</strong>
    </template>
  </div>
  <div v-else-if="route" class="route-details">
    <Field15Tokens
      :elements="route.elements"
      :entry-id="dataset.id"
      :route="resolvedRoute"
      :resolution-error="routeError"
      :interaction="interaction"
    />
    <div v-if="route.resolution.status === 'resolving'" class="status">resolving…</div>
    <div v-else-if="route.resolution.status === 'error'" class="status error">
      {{ route.resolution.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceDatasetEntry } from "@open-aviation/tangram-core/api";
import Field15Tokens from "./Field15Tokens.vue";
import { isNavaidPointEntry, isPlannedRouteEntry } from "./datasets";
import type { NavaidInteraction } from "./interaction";

const props = defineProps<{
  dataset: WorkspaceDatasetEntry;
  interaction: NavaidInteraction;
}>();
const point = computed(() =>
  isNavaidPointEntry(props.dataset) ? props.dataset.payload.point : null
);
const route = computed(() =>
  isPlannedRouteEntry(props.dataset) ? props.dataset.payload : null
);
const resolvedRoute = computed(() =>
  route.value?.resolution.status === "resolved" ? route.value.resolution.route : null
);
const routeError = computed(() =>
  route.value?.resolution.status === "error" ? route.value.resolution.message : null
);
const coordinates = computed(() => {
  if (!point.value) return "";
  const latitude = point.value.latitude;
  const longitude = point.value.longitude;
  return `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? "N" : "S"} ${Math.abs(
    longitude
  ).toFixed(4)}°${longitude >= 0 ? "E" : "W"}`;
});
</script>

<style scoped>
.details-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 8px;
  font-size: 11px;
}

.details-grid > span,
.status {
  color: var(--t-muted);
}

.details-grid > strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 500;
}

.route-details {
  display: grid;
  gap: 4px;
}

.status {
  padding-inline: 2px;
  font-size: 10px;
}

.error {
  color: var(--t-error);
}
</style>
