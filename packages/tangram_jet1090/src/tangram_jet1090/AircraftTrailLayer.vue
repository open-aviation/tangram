<script setup lang="ts">
import { computed, inject, isRef, onUnmounted, ref, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";
import * as L from "leaflet";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}
const activeEntityId = computed(() => {
  const id = tangramApi.state.activeEntityId;
  return isRef(id) ? id.value : (id ?? null);
});
const polyline = ref<L.Polyline | null>(null);

watch(
  () => activeEntityId.value,
  async newId => {
    if (!tangramApi.map.isReady.value) return;

    const map = tangramApi.map.getMapInstance();

    if (polyline.value) {
      polyline.value.remove();
      polyline.value = null;
    }

    if (!newId) return;

    try {
      const response = await fetch(`/data/${newId}`);
      if (!response.ok) throw new Error("Failed to fetch trajectory");
      const data = await response.json();

      const latLngs = data
        .filter(
          (p: { latitude?: number | null; longitude?: number | null }) =>
            p.latitude != null && p.longitude != null
        )
        .map(
          (p: { latitude: number; longitude: number }) =>
            [p.latitude, p.longitude] as L.LatLngExpression
        );

      if (latLngs.length > 1) {
        polyline.value = L.polyline(latLngs, { color: "purple" }).addTo(map);
      }
    } catch (error) {
      console.error(`Error fetching trail for ${newId}:`, error);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (polyline.value) {
    polyline.value.remove();
  }
});
</script>
