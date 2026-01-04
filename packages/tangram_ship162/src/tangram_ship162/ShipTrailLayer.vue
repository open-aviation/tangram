<script setup lang="ts">
import { inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { generateSegments } from "@open-aviation/tangram-core/utils";
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

  const allPaths: any[] = [];

  for (const [id, data] of shipStore.selected) {
    if (data.trajectory.length < 2) continue;

    const segments = generateSegments(data.trajectory, {
      getPosition: p =>
        p.latitude != null && p.longitude != null ? [p.longitude, p.latitude, 0] : null,
      getTimestamp: p => p.timestamp || null,
      getColor: () => [128, 0, 128, 255],
      gapColor: [150, 150, 150, 128],
      maxGapSeconds: 3600
    });

    for (const segment of segments) {
      allPaths.push(segment);
    }
  }

  if (allPaths.length > 0) {
    const trailLayer = new PathLayer({
      id: `ship-trails`,
      data: allPaths,
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      getPath: d => d.path,
      getColor: d => d.colors,
      getWidth: d => (d.dashed ? 1 : 2),
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: d => (d.dashed ? [5, 5] : [0, 0]),
      dashJustified: true
    }) as Layer;
    layerDisposable.value = tangramApi.map.addLayer(trailLayer);
  }
};

watch(() => shipStore.version, updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
