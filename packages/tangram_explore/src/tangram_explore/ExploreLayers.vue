<script setup lang="ts">
import { watch, inject, onUnmounted, reactive, computed } from "vue";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { layers, parseColor, pluginConfig } from "./store";

const api = inject<TangramApi>("tangramApi")!;
const layerDisposables = new Map<string, Disposable>();

const hoverInfo = reactive({
  x: 0,
  y: 0,
  object: null as Record<string, unknown> | null,
  layerLabel: ""
});

const enable3d = computed(() => {
  if (pluginConfig.enable_3d === "inherit") return api.config.map.enable_3d;
  return !!pluginConfig.enable_3d;
});

watch(
  [layers, enable3d],
  ([currentLayers, is3d]) => {
    const activeIds = new Set(currentLayers.map(l => l.id));

    for (const [id, disposable] of layerDisposables) {
      if (!activeIds.has(id)) {
        disposable.dispose();
        layerDisposables.delete(id);
      }
    }

    for (const entry of currentLayers) {
      const table = entry.table;
      const numRows = table.numRows;
      const schema = table.schema;

      const latField = schema.fields.find(
        f => f.name === "latitude" || f.name === "lat"
      )?.name;
      const lonField = schema.fields.find(
        f => f.name === "longitude" || f.name === "lon" || f.name === "lng"
      )?.name;

      let altField: string | undefined;
      if (is3d) {
        altField = schema.fields.find(
          f => f.name === "altitude" || f.name === "alt" || f.name === "height"
        )?.name;
      }

      if (!latField || !lonField) continue;

      const latData = table.getChild(latField)!;
      const lonData = table.getChild(lonField)!;
      const altData = altField ? table.getChild(altField) : null;

      if (entry.style.kind === "scatter") {
        const opts = entry.style;
        const deckLayer = new ScatterplotLayer({
          id: `explore-layer-${entry.id}`,
          data: { length: numRows },
          visible: entry.visible,
          pickable: opts.pickable,
          opacity: opts.opacity,
          stroked: opts.stroked,
          filled: opts.filled,
          radiusScale: opts.radius_scale,
          radiusMinPixels: opts.radius_min_pixels,
          radiusMaxPixels: opts.radius_max_pixels,
          lineWidthMinPixels: opts.line_width_min_pixels,
          // radiusUnits: "pixels",
          getPosition: (_: unknown, { index }: { index: number }) => {
            const lat = latData.get(index);
            const lon = lonData.get(index);
            const alt = altData ? altData.get(index) : 0;
            return [lon, lat, alt];
          },
          getFillColor: parseColor(opts.fill_color, [255, 140, 0, 200]),
          getLineColor: parseColor(opts.line_color, [0, 0, 0, 255]),
          onHover: (info: PickingInfo) => {
            if (info.index !== -1) {
              const row = table.get(info.index);
              hoverInfo.object = row ? row.toJSON() : null;
              hoverInfo.x = info.x;
              hoverInfo.y = info.y;
              hoverInfo.layerLabel = entry.label;
            } else {
              hoverInfo.object = null;
            }
          },
          updateTriggers: {
            getPosition: [entry.id, is3d],
            getFillColor: [entry.id, JSON.stringify(opts.fill_color)],
            getLineColor: [entry.id, JSON.stringify(opts.line_color)]
          }
        });

        if (!layerDisposables.has(entry.id)) {
          layerDisposables.set(entry.id, api.map.setLayer(deckLayer));
        } else {
          api.map.setLayer(deckLayer);
        }
      }
    }
  },
  { deep: true }
);

onUnmounted(() => {
  for (const disposable of layerDisposables.values()) {
    disposable.dispose();
  }
  layerDisposables.clear();
});
</script>

<template>
  <div
    v-if="hoverInfo.object"
    class="explore-tooltip"
    :style="{ left: `${hoverInfo.x}px`, top: `${hoverInfo.y}px` }"
  >
    <div class="tooltip-header">{{ hoverInfo.layerLabel }}</div>
    <div class="tooltip-grid">
      <template v-for="(val, key) in hoverInfo.object" :key="key">
        <div class="key">{{ key }}</div>
        <div class="val">
          {{ typeof val === "number" && !Number.isInteger(val) ? val.toFixed(4) : val }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.explore-tooltip {
  position: absolute;
  background: white;
  color: black;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(12px, 12px);
  z-index: 2000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.05);
  max-width: 250px;
}

.tooltip-header {
  font-weight: bold;
  padding-bottom: 4px;
  color: #333;
}

.tooltip-grid {
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 12px;
  row-gap: 1px;
}

.key {
  text-align: right;
  font-weight: 500;
}
</style>
