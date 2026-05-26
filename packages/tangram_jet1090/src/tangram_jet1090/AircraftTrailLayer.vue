<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import {
  buildTrajectoryCurtainPolygons,
  buildTrajectoryLayers,
  generateSegments,
  generateTimedSegments,
  type PathSegment,
  prepareTimedTrajectoryLayerData,
  type PreparedTimedTrajectoryLayerData,
  TimedTrajectoryLayerController,
  type TimedPathSegment
} from "@open-aviation/tangram-core/trajectory";
import { aircraftStore, pluginConfig } from "./store";
import {
  MAX_GAP_SECONDS,
  GAP_COLOR,
  getPointColor,
  getPosition,
  type TrailConfig,
  type Color
} from "./utils";
import {
  importedAircraftTimestamp,
  isJet1090ImportedHistoryDataset
} from "./imported_trajectory";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const liveLayerDisposables = new Map<string, Disposable>();
const importedLayerDisposables = new Map<string, Disposable>();
const importedEntries = computed(() =>
  tangramApi.workspace.datasets.value.filter(isJet1090ImportedHistoryDataset)
);
const importedFlights = computed(() =>
  importedEntries.value.flatMap(entry => (entry.visible ? entry.payload.flights : []))
);
let preparedImportedTrailData: PreparedTimedTrajectoryLayerData<Color> = {
  segmentData: {
    timeOrigin: 0,
    solidSegments: [],
    dashedSegments: []
  },
  polygonData: []
};
let importedLayerController: TimedTrajectoryLayerController<Color> | null = null;

const syncLayerSet = (
  layers: ReturnType<typeof buildTrajectoryLayers>,
  store: Map<string, Disposable>
) => {
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

const updateLiveLayers = () => {
  if (!tangramApi.time.isLive.value) {
    syncLayerSet([], liveLayerDisposables);
    return;
  }

  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: pluginConfig.enable3d
  };

  const allSegments: PathSegment<Color>[] = [];

  for (const [, data] of aircraftStore.selected) {
    if (data.trajectory.length < 2) continue;

    const prevAlt = { value: null as number | null };
    const segments = generateSegments(data.trajectory, {
      getPosition: p => getPosition(p, config.enable3d, prevAlt),
      getTimestamp: p => p.timestamp || null,
      getColor: p => getPointColor(p, config),
      gapColor: GAP_COLOR,
      maxGapSeconds: MAX_GAP_SECONDS
    });

    for (const segment of segments) {
      allSegments.push(segment);
    }
  }

  const layers = buildTrajectoryLayers(allSegments, {
    idPrefix: "jet1090-live-trails",
    polygons:
      config.trailType === "curtain"
        ? buildTrajectoryCurtainPolygons(allSegments)
        : undefined
  });
  syncLayerSet(layers, liveLayerDisposables);
};

const updateImportedLayers = () => {
  importedLayerController = new TimedTrajectoryLayerController(
    preparedImportedTrailData,
    {
      idPrefix: "jet1090-imported-trails",
      currentTime: tangramApi.time.currentTime.value
    }
  );
  syncLayerSet(importedLayerController.layers, importedLayerDisposables);
};

const tickImportedLayers = () => {
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

const rebuildImportedTrailData = () => {
  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: pluginConfig.enable3d
  };

  const timedSegments: TimedPathSegment<Color>[] = [];

  for (const flight of importedFlights.value) {
    if (flight.length < 2) continue;

    const prevAlt = { value: null as number | null };
    const segments = generateTimedSegments(flight, {
      getPosition: p => getPosition(p, config.enable3d, prevAlt),
      getTimestamp: p => importedAircraftTimestamp(p),
      getColor: p => getPointColor(p, config),
      gapColor: GAP_COLOR,
      maxGapSeconds: MAX_GAP_SECONDS
    });

    for (const segment of segments) {
      timedSegments.push(segment);
    }
  }

  preparedImportedTrailData = prepareTimedTrajectoryLayerData(timedSegments, {
    includeCurtains: config.trailType === "curtain"
  });
};

watch(
  [
    () => aircraftStore.version,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha,
    () => pluginConfig.enable3d,
    () => tangramApi.time.isLive.value
  ],
  updateLiveLayers,
  {}
);

watch(
  [
    importedFlights,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha,
    () => pluginConfig.enable3d
  ],
  () => {
    rebuildImportedTrailData();
    updateImportedLayers();
  },
  { immediate: true }
);

watch(() => tangramApi.time.currentTime.value, tickImportedLayers);

onUnmounted(() => {
  liveLayerDisposables.forEach(d => d.dispose());
  liveLayerDisposables.clear();
  importedLayerDisposables.forEach(d => d.dispose());
  importedLayerDisposables.clear();
  importedLayerController = null;
});
</script>
