<template>
  <div class="globe-toggle">
    <button
      :class="{ active: isGlobeView }"
      :title="isGlobeView ? 'Switch to mercator view' : 'Switch to globe view'"
      @click="toggleGlobe"
    >
      <span class="fa fa-globe"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, inject } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const isGlobeView = ref(false);

const toggleGlobe = () => {
  if (!tangramApi.map.isReady.value) return;

  const mapInstance = tangramApi.map.getMapInstance();
  const newGlobeState = !isGlobeView.value;

  mapInstance.setProjection(newGlobeState ? { type: "globe" } : { type: "mercator" });

  isGlobeView.value = newGlobeState;
};
</script>

<style scoped>
.globe-toggle button {
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s ease;
  color: #333;
}

.globe-toggle button:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

.globe-toggle button.active {
  background: oklch(0.72 0.075 245);
  color: white;
  border-color: oklch(0.59 0.075 245);
}
</style>
