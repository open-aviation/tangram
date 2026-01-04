<script setup lang="ts">
import { inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { shipStore } from "./store";
import type { Layer } from "@deck.gl/core";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposable: Ref<Disposable | null> = ref(null);

const updateLayer = async () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  const ship = shipStore.selectedHistoryInterval;
  if (!ship) return;

  const start_ts = new Date(ship.start_ts + "Z").getTime();
  const end_ts = new Date(ship.end_ts + "Z").getTime();
  const response = await fetch(
    `/ship162/history/${ship.mmsi}/${Math.floor(start_ts)}/${Math.floor(end_ts)}`
  );
  const data = await response.json();

  const layers: Layer[] = [];
  const MAX_GAP_SECONDS = 3600;
  const segments: { path: number[][]; colors: any[]; dashed: boolean }[] = [];
  let currentSegment: { path: number[][]; colors: any[]; dashed: boolean } | null =
    null;
  let lastPoint: any = null;

  for (const point of data) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    if (
      lastPoint &&
      Math.abs(
        new Date(point.timestamp).getTime() - new Date(lastPoint.timestamp).getTime()
      ) /
        1000 >
        MAX_GAP_SECONDS
    ) {
      if (currentSegment && currentSegment.path.length > 1) {
        segments.push(currentSegment);
      }
      if (lastPoint) {
        segments.push({
          path: [
            [lastPoint.longitude, lastPoint.latitude],
            [point.longitude, point.latitude]
          ],
          colors: [
            [150, 150, 150],
            [150, 150, 150]
          ],
          dashed: true
        });
      }
      currentSegment = { path: [], colors: [], dashed: false };
    }
    if (!currentSegment) {
      currentSegment = { path: [], colors: [], dashed: false };
    }
    currentSegment.path.push([point.longitude, point.latitude]);
    currentSegment.colors.push([128, 0, 128]);
    lastPoint = point;
  }
  if (currentSegment && currentSegment.path.length > 1) {
    segments.push(currentSegment);
  }

  segments.forEach((segment, idx) => {
    layers.push(
      new PathLayer({
        id: `ship-history-path-${idx}`,
        data: [{ path: segment.path, colors: segment.colors }],
        pickable: false,
        widthScale: 1,
        widthMinPixels: 2,
        getPath: d => d.path,
        getColor: d => d.colors,
        getWidth: segment.dashed ? 1 : 2,
        parameters: { depthTest: false },
        ...(segment.dashed
          ? {
              extensions: [new PathStyleExtension({ dash: true })],
              getDashArray: [5, 5],
              dashJustified: true
            }
          : {})
      })
    );
  });

  const layerPromises = layers.map(layer => tangramApi.map.addLayer(layer));
  layerDisposable.value = {
    dispose: () => {
      layerPromises.forEach(d => d.dispose());
    }
  };
};

watch(() => shipStore.historyVersion, updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
