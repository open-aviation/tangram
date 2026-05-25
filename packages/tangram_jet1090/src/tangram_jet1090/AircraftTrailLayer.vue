<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { generateSegments, type PathSegment } from "@open-aviation/tangram-core/utils";
import { aircraftStore, pluginConfig } from "./store";
import {
  MAX_GAP_SECONDS,
  GAP_COLOR,
  getPointColor,
  getPosition,
  buildTrailLayers,
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

const syncLayerSet = (
  layers: ReturnType<typeof buildTrailLayers>["layers"],
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

  const { layers } = buildTrailLayers(allSegments, config, "jet1090-live-trails");
  syncLayerSet(layers, liveLayerDisposables);
};

const updateImportedLayers = () => {
  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: pluginConfig.enable3d
  };

  const allSegments: PathSegment<Color>[] = [];

  for (const flight of importedFlights.value) {
    if (flight.length < 2) continue;

    const prevAlt = { value: null as number | null };
    const segments = generateSegments(flight, {
      getPosition: p => getPosition(p, config.enable3d, prevAlt),
      getTimestamp: p => importedAircraftTimestamp(p),
      getColor: p => getPointColor(p, config),
      gapColor: GAP_COLOR,
      maxGapSeconds: MAX_GAP_SECONDS
    });

    for (const segment of segments) {
      allSegments.push(segment);
    }
  }

  const { layers } = buildTrailLayers(allSegments, config, "jet1090-imported-trails");
  syncLayerSet(layers, importedLayerDisposables);
};

watch(
  [
    () => aircraftStore.version,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha,
    () => pluginConfig.enable3d
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
  updateImportedLayers,
  {}
);

onUnmounted(() => {
  liveLayerDisposables.forEach(d => d.dispose());
  liveLayerDisposables.clear();
  importedLayerDisposables.forEach(d => d.dispose());
  importedLayerDisposables.clear();
});
</script>
