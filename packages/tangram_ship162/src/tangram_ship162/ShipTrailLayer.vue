<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram/api";
import { selectedShip } from "./store";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

const updateLayer = () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  if (
    activeEntity.value?.type === "ship162_ship" &&
    selectedShip.id === activeEntity.value.id &&
    selectedShip.trajectory.length > 1
  ) {
    const latLngs = selectedShip.trajectory
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => [p.longitude, p.latitude]);

    const trailLayer = new PathLayer({
      id: `ship-trail-layer-${activeEntity.value.id}`,
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
};

watch(() => selectedShip.trajectory.length, updateLayer);
watch(() => activeEntity.value?.id, updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
