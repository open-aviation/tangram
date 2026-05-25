<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from "vue";
import type { TangramApi } from "./api";

const api = inject<TangramApi>("tangramApi")!;
const isDragging = ref(false);
let dragDepth = 0;

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
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

function summarizeFailures(messages: string[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0];
  return `${messages.slice(0, 3).join("\n")}${messages.length > 3 ? "\n..." : ""}`;
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;

  try {
    const result = await api.import.importFiles(files);

    if (result.bounds) {
      api.map.getMapInstance().fitBounds(
        [
          [result.bounds.minLon, result.bounds.minLat],
          [result.bounds.maxLon, result.bounds.maxLat]
        ],
        { padding: 48, maxZoom: 14 }
      );
    }

    if (result.failures.length > 0) {
      // TODO: replace alert() once tangram_core has a proper toast notification system.
      alert(summarizeFailures(result.failures.map(failure => failure.message)));
    }
  } catch (error) {
    alert(error instanceof Error ? error.message : "Could not import dropped files");
    console.error(error);
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
