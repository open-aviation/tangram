<template>
  <div class="map-layers-widget">
    <div
      v-for="(visible, id) in api.map.mapLayerVisibility"
      :key="id"
      class="layer-item"
    >
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="visible"
          @change="
            api.map.setMapLayerVisibility(
              String(id),
              ($event.target as HTMLInputElement).checked
            )
          "
        />
        {{ id }}
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from "vue";
import type { TangramApi } from "./api";

const api = inject<TangramApi>("tangramApi")!;
</script>

<style scoped>
.map-layers-widget {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--t-border);
  border-radius: 4px;
  padding: 4px;
  background: var(--t-bg);
}
.layer-item {
  padding: 2px 0;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
  color: var(--t-fg);
}
input[type="checkbox"] {
  accent-color: var(--t-accent1);
}
</style>
