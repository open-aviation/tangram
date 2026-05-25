<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { generateSegments, type PathSegment } from "@open-aviation/tangram-core/utils";
import { shipStore } from "./store";
import type { Ship162Vessel } from ".";
import type { Layer } from "@deck.gl/core";
import {
  importedShipTimestamp,
  isShip162ImportedHistoryDataset
} from "./imported_trajectory";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const liveLayerDisposable: Ref<Disposable | null> = ref(null);
const importedLayerDisposable: Ref<Disposable | null> = ref(null);
const importedEntries = computed(() =>
  tangramApi.workspace.datasets.value.filter(isShip162ImportedHistoryDataset)
);
const importedTracks = computed(() =>
  importedEntries.value.flatMap(entry => (entry.visible ? entry.payload.tracks : []))
);

const buildTrailLayer = (
  id: string,
  allPaths: PathSegment<TrailColor>[]
): Layer | null => {
  if (allPaths.length === 0) {
    return null;
  }

  return new PathLayer({
    id,
    data: allPaths,
    pickable: false,
    widthScale: 1,
    widthMinPixels: 2,
    getPath: d => d.path,
    getColor: d => d.colors,
    getWidth: d => (d.dashed ? 1 : 2),
    extensions: [new PathStyleExtension({ dash: true })],
    getDashArray: (d: PathSegment<TrailColor>) => (d.dashed ? [5, 5] : [0, 0]),
    dashJustified: true
  }) as Layer;
};

type TrailColor = [number, number, number, number];

const updateLiveLayer = () => {
  if (liveLayerDisposable.value) {
    liveLayerDisposable.value.dispose();
    liveLayerDisposable.value = null;
  }

  type TrailColor = [number, number, number, number];
  const allPaths: PathSegment<TrailColor>[] = [];

  for (const [, data] of shipStore.selected) {
    if (data.trajectory.length < 2) continue;

    const segments = generateSegments<Ship162Vessel, TrailColor>(data.trajectory, {
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

  const trailLayer = buildTrailLayer("ship-live-trails", allPaths);
  if (trailLayer) {
    liveLayerDisposable.value = tangramApi.map.addLayer(trailLayer, {
      slot: "live_trails"
    });
  }
};

const updateImportedLayer = () => {
  if (importedLayerDisposable.value) {
    importedLayerDisposable.value.dispose();
    importedLayerDisposable.value = null;
  }

  const allPaths: PathSegment<TrailColor>[] = [];

  for (const track of importedTracks.value) {
    if (track.length < 2) continue;

    const segments = generateSegments<Ship162Vessel, TrailColor>(track, {
      getPosition: p =>
        p.latitude != null && p.longitude != null ? [p.longitude, p.latitude, 0] : null,
      getTimestamp: p => importedShipTimestamp(p),
      getColor: () => [128, 0, 128, 255],
      gapColor: [150, 150, 150, 128],
      maxGapSeconds: 3600
    });

    for (const segment of segments) {
      allPaths.push(segment);
    }
  }

  const trailLayer = buildTrailLayer("ship-imported-trails", allPaths);
  if (trailLayer) {
    importedLayerDisposable.value = tangramApi.map.addLayer(trailLayer, {
      slot: "live_trails"
    });
  }
};

watch([() => shipStore.version], updateLiveLayer);
watch([importedTracks], updateImportedLayer);

onUnmounted(() => {
  liveLayerDisposable.value?.dispose();
  importedLayerDisposable.value?.dispose();
});
</script>
