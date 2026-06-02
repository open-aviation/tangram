<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import {
  buildTrajectoryLayers,
  generateSegments,
  generateTimedSegments,
  prepareTimedTrajectoryLayerData,
  type PathSegment,
  type PreparedTimedTrajectoryLayerData,
  TimedTrajectoryLayerController,
  type TimedPathSegment
} from "@open-aviation/tangram-core/trajectory";
import { oklchToDeckGLColor, parseColorSpec } from "@open-aviation/tangram-core/utils";
import { pluginConfig, shipStore } from "./store";
import type { Ship162Vessel } from ".";
import type { Layer } from "@deck.gl/core";
import {
  importedShipTimestamp,
  isShip162ImportedHistoryDataset
} from "./imported_trajectory";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

type TrailColor = [number, number, number, number];

const DEFAULT_SPEED_MAX_KNOTS = 14;

function getTrailColor(vessel: Ship162Vessel): TrailColor {
  const alpha = Math.round(Math.max(0, Math.min(1, pluginConfig.trailAlpha)) * 255);
  const configuredColor = pluginConfig.trailColor;

  if (typeof configuredColor === "string") {
    const parsed = parseColorSpec(configuredColor) ?? [128, 0, 128, 255];
    return [parsed[0], parsed[1], parsed[2], alpha];
  }

  const speed = vessel.speed ?? 0;
  const rangeMin = configuredColor.min ?? 0;
  const rangeMax = configuredColor.max ?? DEFAULT_SPEED_MAX_KNOTS;
  const denominator = rangeMax - rangeMin;
  const t =
    denominator === 0 ? 0 : Math.max(0, Math.min(1, (speed - rangeMin) / denominator));
  const hue = 270 + t * (0 - 270);
  return oklchToDeckGLColor(0.65, 0.2, hue, alpha);
}

const liveLayerDisposables = new Map<string, Disposable>();
const importedLayerDisposables = new Map<string, Disposable>();
const importedEntries = computed(() =>
  tangramApi.workspace.datasets.value.filter(isShip162ImportedHistoryDataset)
);
const importedTracks = computed(() =>
  importedEntries.value.flatMap(entry => (entry.visible ? entry.payload.tracks : []))
);
let preparedImportedPaths: PreparedTimedTrajectoryLayerData<TrailColor> = {
  segmentData: {
    timeOrigin: 0,
    solidSegments: [],
    dashedSegments: []
  },
  polygonData: []
};
let importedLayerController: TimedTrajectoryLayerController<TrailColor> | null = null;

const syncLayerSet = (layers: Layer[], store: Map<string, Disposable>) => {
  const currentIds = new Set(layers.map(layer => layer.id));

  for (const [id, disposable] of store) {
    if (!currentIds.has(id)) {
      disposable.dispose();
      store.delete(id);
    }
  }

  for (const layer of layers) {
    if (!store.has(layer.id)) {
      store.set(
        layer.id,
        tangramApi.map.setLayer(layer, {
          slot: "live_trails"
        })
      );
    } else {
      tangramApi.map.setLayer(layer, {
        slot: "live_trails"
      });
    }
  }
};

const updateLiveLayer = () => {
  if (!tangramApi.time.isLive.value) {
    syncLayerSet([], liveLayerDisposables);
    return;
  }

  const allPaths: PathSegment<TrailColor>[] = [];

  for (const [, data] of shipStore.selected) {
    if (data.trajectory.length < 2) continue;

    const segments = generateSegments<Ship162Vessel, TrailColor>(data.trajectory, {
      getPosition: p =>
        p.latitude != null && p.longitude != null ? [p.longitude, p.latitude, 0] : null,
      getTimestamp: p => p.timestamp || null,
      getColor: getTrailColor,
      gapColor: [150, 150, 150, 128],
      maxGapSeconds: 3600
    });

    for (const segment of segments) {
      allPaths.push(segment);
    }
  }

  syncLayerSet(
    buildTrajectoryLayers(allPaths, {
      idPrefix: "ship-live-trails"
    }),
    liveLayerDisposables
  );
};

const updateImportedLayer = () => {
  importedLayerController = new TimedTrajectoryLayerController(preparedImportedPaths, {
    idPrefix: "ship-imported-trails",
    currentTime: tangramApi.time.currentTime.value
  });
  syncLayerSet(importedLayerController.layers, importedLayerDisposables);
};

const tickImportedLayer = () => {
  if (!importedLayerController) return;

  const update = importedLayerController.setCurrentTime(
    tangramApi.time.currentTime.value
  );
  if (update.layersChanged) {
    syncLayerSet(importedLayerController.layers, importedLayerDisposables);
  }

  if (update.needsRepaint) {
    tangramApi.map.requestRepaint();
  }
};

const rebuildImportedLayerData = () => {
  const allPaths: TimedPathSegment<TrailColor>[] = [];

  for (const track of importedTracks.value) {
    if (track.length < 2) continue;

    const segments = generateTimedSegments<Ship162Vessel, TrailColor>(track, {
      getPosition: p =>
        p.latitude != null && p.longitude != null ? [p.longitude, p.latitude, 0] : null,
      getTimestamp: p => importedShipTimestamp(p),
      getColor: getTrailColor,
      gapColor: [150, 150, 150, 128],
      maxGapSeconds: 3600
    });

    for (const segment of segments) {
      allPaths.push(segment);
    }
  }

  preparedImportedPaths = prepareTimedTrajectoryLayerData(allPaths);
};

watch(
  [
    () => shipStore.version,
    () => tangramApi.time.isLive.value,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha
  ],
  updateLiveLayer,
  { deep: true }
);
watch(
  [importedTracks, () => pluginConfig.trailColor, () => pluginConfig.trailAlpha],
  () => {
    rebuildImportedLayerData();
    updateImportedLayer();
  },
  { immediate: true, deep: true }
);
watch(() => tangramApi.time.currentTime.value, tickImportedLayer);

onUnmounted(() => {
  liveLayerDisposables.forEach(disposable => disposable.dispose());
  liveLayerDisposables.clear();
  importedLayerDisposables.forEach(disposable => disposable.dispose());
  importedLayerDisposables.clear();
  importedLayerController = null;
});
</script>
