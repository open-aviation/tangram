<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram/api";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const layerDisposable: Ref<Disposable | null> = ref(null);
const abortController = ref<AbortController | null>(null);

watch(
  [activeEntity, () => tangramApi.map.isReady.value],
  async ([newEntity, isMapReady]) => {
    abortController.value?.abort();
    if (layerDisposable.value) {
      layerDisposable.value.dispose();
      layerDisposable.value = null;
    }

    if (!isMapReady || !newEntity || newEntity.type !== "ship162_ship") {
      return;
    }

    abortController.value = new AbortController();
    const { signal } = abortController.value;

    try {
      const response = await fetch(`/ship162/data/${newEntity.id}`, { signal });
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
          id: `ship-trail-layer-${newEntity.id}`,
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
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error(`Error fetching trail for ${newEntity.id}:`, error);
      }
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  abortController.value?.abort();
  layerDisposable.value?.dispose();
});
</script>
