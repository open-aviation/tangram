<script setup lang="ts">
import { watch, inject, onUnmounted, reactive, computed } from "vue";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { layers, parseColor, pluginConfig, type GeoJsonData, type GeoJsonOptions } from "./store";

const api = inject<TangramApi>("tangramApi")!;
const layerDisposables = new Map<string, Disposable>();

const hoverInfo = reactive({
  x: 0,
  y: 0,
  object: null as Record<string, unknown> | null,
  layerLabel: ""
});

const enable3d = computed(() => !!pluginConfig.enable_3d);

type GeoJsonFeature = Record<string, unknown> & {
  properties?: Record<string, unknown> | null;
};

function featureCategory(feature: unknown, opts: GeoJsonOptions): string {
  if (!opts.category_field || typeof feature !== "object" || feature === null) return "";
  const properties = (feature as GeoJsonFeature).properties;
  const value = properties?.[opts.category_field];
  return value === undefined || value === null ? "(empty)" : String(value);
}

function filteredGeoJson(data: GeoJsonData, opts: GeoJsonOptions): GeoJsonData {
  if (opts.style_mode !== "category" || !opts.category_field) return data;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) return data;

  return {
    ...data,
    features: data.features.filter(feature => {
      const category = featureCategory(feature, opts);
      return !opts.hidden_categories[category];
    })
  };
}

const categoryPalette = [
  "oklch(54.87% 0.222 260.33)", // uchu blue 5
  "oklch(58.63% 0.231 19.6)", // uchu red 5
  "oklch(75.23% 0.209 144.64)", // uchu green 5
  "oklch(74.61% 0.171 51.56)", // uchu orange 5
  "oklch(49.39% 0.215 298.31)", // uchu purple 5
  "oklch(82.23% 0.112 355.33)", // uchu pink 5
  "oklch(89% 0.146 91.5)", // uchu yellow 5
  "oklch(56.82% 0.004 247.89)" // uchu gray 9
];

function defaultCategoryColor(category: string): string {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return categoryPalette[hash % categoryPalette.length];
}

function categoryColor(feature: unknown, opts: GeoJsonOptions) {
  const category = featureCategory(feature, opts);
  return opts.category_colors[category] ?? defaultCategoryColor(category);
}

function featureColor(feature: unknown, opts: GeoJsonOptions) {
  if (opts.style_mode === "category") return categoryColor(feature, opts);
  return opts.fill_color;
}

function geoJsonTooltipProperties(object: unknown): Record<string, unknown> | null {
  if (typeof object !== "object" || object === null) return null;
  const properties = (object as GeoJsonFeature).properties;
  return properties && Object.keys(properties).length > 0 ? properties : null;
}

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
      if (entry.source === "geojson") {
        const opts = entry.style;
        const deckLayer = new GeoJsonLayer({
          id: `explore-layer-${entry.id}`,
          data: filteredGeoJson(entry.data, opts) as never,
          visible: entry.visible,
          pickable: opts.pickable,
          opacity: opts.opacity,
          stroked: opts.stroked,
          filled: opts.filled,
          extruded: opts.extruded,
          pointRadiusMinPixels: opts.point_radius,
          lineWidthMinPixels: opts.line_width,
          getFillColor: (feature: unknown) => parseColor(featureColor(feature, opts), [2, 126, 199, 180]),
          getLineColor: (feature: unknown) =>
            parseColor(opts.style_mode === "single" ? opts.line_color : featureColor(feature, opts), [2, 126, 199, 255]),
          onHover: (info: PickingInfo) => {
            const properties = geoJsonTooltipProperties(info.object);
            if (properties) {
              hoverInfo.object = properties;
              hoverInfo.x = info.x;
              hoverInfo.y = info.y;
              hoverInfo.layerLabel = entry.label;
            } else {
              hoverInfo.object = null;
            }
          },
          updateTriggers: {
            getFillColor: [
              entry.id,
              opts.style_mode,
              opts.category_field,
              JSON.stringify(opts.fill_color),
              JSON.stringify(opts.category_colors)
            ],
            getLineColor: [
              entry.id,
              opts.style_mode,
              opts.category_field,
              JSON.stringify(opts.line_color),
              JSON.stringify(opts.category_colors)
            ]
          }
        });

        if (!layerDisposables.has(entry.id)) {
          layerDisposables.set(entry.id, api.map.setLayer(deckLayer));
        } else {
          api.map.setLayer(deckLayer);
        }
        continue;
      }

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
