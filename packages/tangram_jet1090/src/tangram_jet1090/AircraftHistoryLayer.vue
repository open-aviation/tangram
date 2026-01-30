<script setup lang="ts">
import { inject, onUnmounted, watch } from "vue";
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
  type Color,
  type PositionData
} from "./utils";

interface HistoryDataPoint extends PositionData {
  timestamp: string;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();

const updateLayer = async () => {
  layerDisposables.forEach(d => d.dispose());
  layerDisposables.clear();

  const flight = aircraftStore.selectedHistoryInterval;
  if (!flight) return;

  const start_ts = new Date(flight.start_ts + "Z").getTime();
  const end_ts = new Date(flight.end_ts + "Z").getTime();
  const response = await fetch(
    `/jet1090/history/${flight.icao24}/${Math.floor(start_ts)}/${Math.floor(end_ts)}`
  );
  const data: HistoryDataPoint[] = await response.json();

  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: pluginConfig.enable3d
  };

  const prevAlt = { value: null as number | null };
  const segments = generateSegments(data, {
    getPosition: (d: HistoryDataPoint) => getPosition(d, config.enable3d, prevAlt),
    getTimestamp: (d: HistoryDataPoint) => new Date(d.timestamp).getTime() / 1000,
    getColor: (d: HistoryDataPoint) => getPointColor(d, config),
    gapColor: GAP_COLOR,
    maxGapSeconds: MAX_GAP_SECONDS
  });

  const allSegments: PathSegment<Color>[] = [...segments];

  const { layers } = buildTrailLayers(allSegments, config, "jet1090-history");

  for (const layer of layers) {
    layerDisposables.set(layer.id, tangramApi.map.setLayer(layer));
  }
};

watch(
  [
    () => aircraftStore.historyVersion,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha,
    () => pluginConfig.enable3d
  ],
  updateLayer,
  { deep: true }
);

onUnmounted(() => {
  layerDisposables.forEach(d => d.dispose());
  layerDisposables.clear();
});
</script>
