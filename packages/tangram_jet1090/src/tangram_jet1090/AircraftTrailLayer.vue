<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram/api";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const activeEntityId = computed(() => tangramApi.state.activeEntityId?.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

watch(
  [activeEntityId, () => tangramApi.map.isReady.value],
  async ([newId, isMapReady]) => {
    if (layerDisposable.value) {
      layerDisposable.value.dispose();
      layerDisposable.value = null;
    }

    if (!newId || !isMapReady) return;

    try {
      const response = await fetch(`/data/${newId}`);
      if (!response.ok) throw new Error("Failed to fetch trajectory");
      const data = await response.json();

      const latLngs = data
        .filter(
          (p: { latitude?: number | null; longitude?: number | null }) =>
            p.latitude != null && p.longitude != null
        )
        .map((p: { longitude: number; latitude: number }) => [p.longitude, p.latitude]);

      if (latLngs.length > 1) {
        const trailLayer = new PathLayer({
          id: `trail-layer-${newId}`,
          data: [{ path: latLngs }],
          pickable: false,
          widthScale: 1,
          widthMinPixels: 2,
          getPath: d => d.path,
          getColor: [128, 0, 128, 255],
          getWidth: 2
        });
        layerDisposable.value = tangramApi.map.addLayer(trailLayer);
      }
    } catch (error) {
      console.error(`Error fetching trail for ${newId}:`, error);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
