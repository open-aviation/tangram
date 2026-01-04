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
  type Color
} from "./utils";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();

const updateLayer = () => {
  const config: TrailConfig = {
    trailType: pluginConfig.trailType,
    trailColor: pluginConfig.trailColor,
    trailAlpha: pluginConfig.trailAlpha,
    enable3d: tangramApi.config.map.enable_3d
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

  const { layers } = buildTrailLayers(allSegments, config, "jet1090-trails");

  const currentIds = new Set(layers.map(l => l.id));

  for (const [id, disposable] of layerDisposables) {
    if (!currentIds.has(id)) {
      disposable.dispose();
      layerDisposables.delete(id);
    }
  }

  for (const layer of layers) {
    if (!layerDisposables.has(layer.id)) {
      layerDisposables.set(layer.id, tangramApi.map.setLayer(layer));
    } else {
      tangramApi.map.setLayer(layer);
    }
  }
};

watch(
  [
    () => aircraftStore.version,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha
  ],
  updateLayer,
  { deep: true }
);

onUnmounted(() => {
  layerDisposables.forEach(d => d.dispose());
  layerDisposables.clear();
});
</script>
