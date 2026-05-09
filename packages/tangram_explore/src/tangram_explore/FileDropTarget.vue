<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { importDroppedFiles } from "./file_import";
import { addSourceLayer } from "./store";
import type { FeatureBounds } from "./feature_source";

const api = inject<TangramApi>("tangramApi")!;
const isDragging = ref(false);
let dragDepth = 0;

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function fitMapToBounds(bounds: FeatureBounds | null) {
  if (!bounds) {
    return;
  }

  api.map.getMapInstance().fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat]
    ],
    { padding: 48, maxZoom: 14 }
  );
}

function onDragEnter(event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  isDragging.value = true;
}

function onDragOver(event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDragging.value = false;
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;

  try {
    const importedLayers = await importDroppedFiles(files);
    for (const layer of importedLayers) {
      addSourceLayer(layer.label, layer.source);
      fitMapToBounds(layer.bounds);
    }
  } catch (err) {
    // TODO: replace alert() once tangram_core has a proper toast notification system.
    alert(err instanceof Error ? err.message : "Could not import dropped files");
    console.error(err);
  }
}

onMounted(() => {
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
});

onUnmounted(() => {
  window.removeEventListener("dragenter", onDragEnter);
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
});
</script>

<template>
  <div v-if="isDragging" class="file-drop-target">
    <div class="drop-card">Drop supported files to add them to the map</div>
  </div>
</template>

<style scoped>
.file-drop-target {
  position: absolute;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--t-accent1) 14%, transparent);
  border: 3px dashed color-mix(in srgb, var(--t-accent1) 68%, var(--t-border));
  backdrop-filter: blur(2px);
}

.drop-card {
  padding: 16px 22px;
  border-radius: 12px;
  color: var(--t-fg);
  background: color-mix(in srgb, var(--t-surface) 92%, var(--t-bg));
  border: 1px solid var(--t-border);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.24);
  font-family: "B612", sans-serif;
  font-weight: 700;
}
</style>
