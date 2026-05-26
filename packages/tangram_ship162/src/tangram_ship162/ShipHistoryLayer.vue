<script setup lang="ts">
import { inject, onUnmounted, ref, watch } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import {
  generateTimedSegments,
  prepareTimedTrajectoryLayerData,
  type PreparedTimedTrajectoryLayerData,
  TimedTrajectoryLayerController,
  type TimedPathSegment
} from "@open-aviation/tangram-core/trajectory";
import { shipStore } from "./store";
import type { Layer } from "@deck.gl/core";

interface ShipHistoryPoint {
  longitude: number | null;
  latitude: number | null;
  timestamp: number;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();
const historyData = ref<ShipHistoryPoint[]>([]);
let requestVersion = 0;
let preparedHistoryPaths: PreparedTimedTrajectoryLayerData<
  [number, number, number, number]
> = {
  segmentData: {
    timeOrigin: 0,
    solidSegments: [],
    dashedSegments: []
  },
  polygonData: []
};
let historyLayerController: TimedTrajectoryLayerController<
  [number, number, number, number]
> | null = null;

const clearLayers = () => {
  layerDisposables.forEach(disposable => disposable.dispose());
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

const renderLayer = () => {
  const ship = shipStore.selectedHistoryInterval;
  if (
    !ship ||
    (preparedHistoryPaths.segmentData.solidSegments.length === 0 &&
      preparedHistoryPaths.segmentData.dashedSegments.length === 0)
  ) {
    historyLayerController = null;
    syncLayerSet([]);
    return;
  }

  historyLayerController = new TimedTrajectoryLayerController(preparedHistoryPaths, {
    idPrefix: "ship-history",
    currentTime: tangramApi.time.currentTime.value
  });

  syncLayerSet(historyLayerController.layers);
};

const tickLayer = () => {
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

  const ship = shipStore.selectedHistoryInterval;
  if (!ship) return;

  const currentRequestVersion = ++requestVersion;
  const start_ts = new Date(ship.start_ts + "Z").getTime();
  const end_ts = new Date(ship.end_ts + "Z").getTime();
  const response = await fetch(
    `/ship162/history/${ship.mmsi}/${Math.floor(start_ts)}/${Math.floor(end_ts)}`
  );
  const data = (await response.json()) as ShipHistoryPoint[];

  if (currentRequestVersion !== requestVersion) return;
  historyData.value = data;

  const timedSegments: TimedPathSegment<[number, number, number, number]>[] = [];
  for (const segment of generateTimedSegments<
    ShipHistoryPoint,
    [number, number, number, number]
  >(historyData.value, {
    getPosition: d =>
      d.longitude != null && d.latitude != null ? [d.longitude, d.latitude, 0] : null,
    getTimestamp: d =>
      typeof d.timestamp === "string" ? Date.parse(d.timestamp) / 1000 : d.timestamp,
    getColor: () => [128, 0, 128, 255],
    gapColor: [150, 150, 150, 128],
    maxGapSeconds: 3600
  })) {
    timedSegments.push(segment);
  }

  preparedHistoryPaths = prepareTimedTrajectoryLayerData(timedSegments);
  renderLayer();
};

watch(() => shipStore.historyVersion, loadHistoryData);
watch(() => tangramApi.time.currentTime.value, tickLayer);

onUnmounted(() => {
  clearLayers();
  historyLayerController = null;
});
</script>
