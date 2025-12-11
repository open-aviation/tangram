<script setup lang="ts">
import { inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { shipStore } from "./store";
import type { Layer } from "@deck.gl/core";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposable: Ref<Disposable | null> = ref(null);

const updateLayer = () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  const allPaths = Array.from(shipStore.selected.entries())
    .filter(([, data]) => data.trajectory.length > 1)
    .map(([id, data]) => ({
      id,
      path: data.trajectory
        .filter(p => p.latitude != null && p.longitude != null)
        .map(p => [p.longitude, p.latitude])
    }));

  if (allPaths.length > 0) {
    const trailLayer = new PathLayer({
      id: `ship-trails`,
      data: allPaths,
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      getPath: d => d.path,
      getColor: [128, 0, 128, 255],
      getWidth: 2
    }) as Layer;
    layerDisposable.value = tangramApi.map.addLayer(trailLayer);
  }
};

watch(() => shipStore.version, updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
