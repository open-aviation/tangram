<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { addGeoJsonLayer, type GeoJsonData } from "./store";

const api = inject<TangramApi>("tangramApi")!;
const isDragging = ref(false);
const errorMessage = ref<string | null>(null);
let dragDepth = 0;

const geometryTypes = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection"
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeoJson(value: unknown): value is GeoJsonData {
  if (!isObject(value)) return false;
  const type = value.type;
  return (
    type === "FeatureCollection" ||
    type === "Feature" ||
    (typeof type === "string" && geometryTypes.has(type))
  );
}

function extendBoundsFromCoordinates(
  coordinates: unknown,
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }
) {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    const [lon, lat] = coordinates;
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    return;
  }
  for (const child of coordinates) extendBoundsFromCoordinates(child, bounds);
}

function extendBoundsFromGeoJson(
  geojson: unknown,
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }
) {
  if (!isObject(geojson)) return;
  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    for (const feature of geojson.features) extendBoundsFromGeoJson(feature, bounds);
    return;
  }
  if (geojson.type === "Feature") {
    extendBoundsFromGeoJson(geojson.geometry, bounds);
    return;
  }
  if (geojson.type === "GeometryCollection" && Array.isArray(geojson.geometries)) {
    for (const geometry of geojson.geometries) extendBoundsFromGeoJson(geometry, bounds);
    return;
  }
  extendBoundsFromCoordinates(geojson.coordinates, bounds);
}

function fitMapToGeoJson(data: GeoJsonData) {
  const bounds = {
    minLon: Number.POSITIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY
  };
  extendBoundsFromGeoJson(data, bounds);
  if (![bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].every(Number.isFinite)) {
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

function hasGeoJsonFile(event: DragEvent) {
  const items = event.dataTransfer?.items;
  if (!items) return false;
  return Array.from(items).some(item => {
    if (item.kind !== "file") return false;
    const file = item.getAsFile();
    if (!file) return true;
    return file.name.endsWith(".geojson") || file.name.endsWith(".json");
  });
}

function onDragEnter(event: DragEvent) {
  if (!hasGeoJsonFile(event)) return;
  event.preventDefault();
  dragDepth += 1;
  isDragging.value = true;
  errorMessage.value = null;
}

function onDragOver(event: DragEvent) {
  if (!hasGeoJsonFile(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDragging.value = false;
}

async function importFile(file: File) {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isGeoJson(parsed)) {
    throw new Error(`${file.name} does not look like GeoJSON`);
  }
  addGeoJsonLayer(file.name, parsed);
  fitMapToGeoJson(parsed);
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;

  const files = Array.from(event.dataTransfer?.files ?? []).filter(
    file => file.name.endsWith(".geojson") || file.name.endsWith(".json")
  );
  if (files.length === 0) return;

  try {
    for (const file of files) {
      await importFile(file);
    }
    errorMessage.value = null;
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "Could not import GeoJSON";
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
  <div v-if="isDragging" class="geojson-drop-target">
    <div class="drop-card">Drop GeoJSON to add it to the map</div>
  </div>
  <div v-if="errorMessage" class="geojson-drop-error">
    {{ errorMessage }}
  </div>
</template>

<style scoped>
.geojson-drop-target {
  position: absolute;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: rgba(2, 126, 199, 0.12);
  border: 3px dashed rgba(2, 126, 199, 0.75);
}

.drop-card {
  padding: 16px 22px;
  border-radius: 12px;
  color: #06476b;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  font-family: "B612", sans-serif;
  font-weight: 700;
}

.geojson-drop-error {
  position: absolute;
  left: 50%;
  bottom: 24px;
  z-index: 2501;
  max-width: 420px;
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 8px;
  color: #7a1f1f;
  background: #fff1f1;
  border: 1px solid #ffc6c6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  font-family: "B612", sans-serif;
  font-size: 0.9rem;
}
</style>
