<script setup lang="ts">
import { inject, onUnmounted, ref, watch } from "vue";
import type { Layer } from "@deck.gl/core";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import {
  generateTimedSegments,
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
  type Color,
  type PositionData
} from "./utils";

interface HistoryDataPoint extends PositionData {
  timestamp: string;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();
const historyData = ref<HistoryDataPoint[]>([]);
let requestVersion = 0;
let preparedHistoryTrailData: PreparedTimedTrajectoryLayerData<Color> = {
  segmentData: {
    timeOrigin: 0,
    solidSegments: [],
    dashedSegments: []
  },
  polygonData: []
};
let historyLayerController: TimedTrajectoryLayerController<Color> | null = null;

const clearLayers = () => {
  layerDisposables.forEach(d => d.dispose());
  layerDisposables.clear();
};

const syncLayerSet = (layers: Layer[]) => {
  const currentIds = new Set(layers.map(layer => layer.id));

  for (const [id, disposable] of layerDisposables) {
    if (!currentIds.has(id)) {
      disposable.dispose();
      layerDisposables.delete(id);
    }
  }

  for (const layer of layers) {
    if (!layerDisposables.has(layer.id)) {
      layerDisposables.set(
        layer.id,
        tangramApi.map.setLayer(layer, {
          slot: "tracks"
        })
      );
    } else {
      tangramApi.map.setLayer(layer, {
        slot: "tracks"
      });
    }
  }
};

const rebuildHistoryTrailData = () => {
  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: pluginConfig.enable3d
  };
  const prevAlt = { value: null as number | null };
  const timedSegments: TimedPathSegment<Color>[] = [];

  for (const segment of generateTimedSegments(historyData.value, {
    getPosition: (d: HistoryDataPoint) => getPosition(d, config.enable3d, prevAlt),
    getTimestamp: (d: HistoryDataPoint) => new Date(d.timestamp).getTime() / 1000,
    getColor: (d: HistoryDataPoint) => getPointColor(d, config),
    gapColor: GAP_COLOR,
    maxGapSeconds: MAX_GAP_SECONDS
  })) {
    timedSegments.push(segment);
  }

  preparedHistoryTrailData = prepareTimedTrajectoryLayerData(timedSegments, {
    includeCurtains: config.trailType === "curtain"
  });
};

const renderLayers = () => {
  const flight = aircraftStore.selectedHistoryInterval;
  if (
    !flight ||
    (preparedHistoryTrailData.segmentData.solidSegments.length === 0 &&
      preparedHistoryTrailData.segmentData.dashedSegments.length === 0)
  ) {
    historyLayerController = null;
    syncLayerSet([]);
    return;
  }

  historyLayerController = new TimedTrajectoryLayerController(
    preparedHistoryTrailData,
    {
      idPrefix: "jet1090-history",
      currentTime: tangramApi.time.currentTime.value
    }
  );

  syncLayerSet(historyLayerController.layers);
};

const tickLayers = () => {
  if (!historyLayerController) return;

  const update = historyLayerController.setCurrentTime(
    tangramApi.time.currentTime.value
  );
  if (update.layersChanged) {
    syncLayerSet(historyLayerController.layers);
  }

  if (update.needsRepaint) {
    tangramApi.map.requestRepaint();
  }
};

const loadHistoryData = async () => {
  clearLayers();
  historyData.value = [];

  const flight = aircraftStore.selectedHistoryInterval;
  if (!flight) return;

  const currentRequestVersion = ++requestVersion;
  const start_ts = new Date(flight.start_ts + "Z").getTime();
  const end_ts = new Date(flight.end_ts + "Z").getTime();
  const response = await fetch(
    `/jet1090/history/${flight.icao24}/${Math.floor(start_ts)}/${Math.floor(end_ts)}`
  );
  const data: HistoryDataPoint[] = await response.json();

  if (currentRequestVersion !== requestVersion) return;
  historyData.value = data;
  rebuildHistoryTrailData();
  renderLayers();
};

watch([() => aircraftStore.historyVersion], loadHistoryData, { deep: true });

watch(
  [
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha,
    () => pluginConfig.enable3d
  ],
  () => {
    rebuildHistoryTrailData();
    renderLayers();
  },
  { deep: true }
);

watch(() => tangramApi.time.currentTime.value, tickLayers);

onUnmounted(() => {
  clearLayers();
  historyLayerController = null;
});
</script>
