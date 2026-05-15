<script setup lang="ts">
import { watch, inject, onUnmounted, shallowReactive, computed } from "vue";
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { Disposable, TangramApi } from "@open-aviation/tangram-core/api";
import { categoricalColor, parseColorSpec } from "@open-aviation/tangram-core/utils";
import {
  layers,
  pluginConfig,
  type FeatureLayerEntry,
  type FeatureStyleOptions,
  type LayerEntry,
  type TrajectoryLayerEntry,
  type TrajectoryStyleOptions
} from "./store";
import {
  featureCategoryValue,
  filteredFeatureCollection,
  type GeoJsonFeature
} from "./feature_source";
import {
  filteredTrajectories,
  trajectoryCategoryValue,
  type Trajectory
} from "./trajectory_source";
import {
  selectExploreTrajectory,
  selectedTrajectoryIdForEntry
} from "./trajectory_selection";

const api = inject<TangramApi>("tangramApi")!;
const layerDisposables = new Map<string, Disposable>();

const hoverInfo = shallowReactive({
  x: 0,
  y: 0,
  object: null as Record<string, unknown> | null,
  layerLabel: ""
});

function clearHoverInfo() {
  hoverInfo.object = null;
  hoverInfo.layerLabel = "";
}

const enable3d = computed(() => !!pluginConfig.enable_3d);

const FALLBACK_ACCENT_COLOR = "oklch(0.5616 0.0895 251.64)";
const SELECTED_TRAJECTORY_COLOR: [number, number, number, number] = [
  255, 255, 255, 255
];

function withAlpha(color: number[], alpha: number): [number, number, number, number] {
  return [color[0] ?? 128, color[1] ?? 128, color[2] ?? 128, alpha];
}

function getFallbackColor(): [number, number, number, number] {
  return parseColorSpec(FALLBACK_ACCENT_COLOR) ?? [128, 128, 128, 255];
}

function defaultFeatureFillColor(): [number, number, number, number] {
  return withAlpha(getFallbackColor(), 180);
}

function defaultFeatureLineColor(): [number, number, number, number] {
  return withAlpha(getFallbackColor(), 255);
}

function defaultTableFillColor(): [number, number, number, number] {
  return withAlpha(getFallbackColor(), 200);
}

function defaultTableLineColor(): [number, number, number, number] {
  return withAlpha(getFallbackColor(), 255);
}

function isFeatureLayerEntry(entry: LayerEntry): entry is FeatureLayerEntry {
  return entry.source.kind === "features";
}

function isTrajectoryLayerEntry(entry: LayerEntry): entry is TrajectoryLayerEntry {
  return entry.source.kind === "trajectories";
}

function featureColor(feature: GeoJsonFeature, opts: FeatureStyleOptions) {
  if (opts.style_mode === "single") {
    return opts.fill_color;
  }

  const category = featureCategoryValue(feature, opts.category_field);
  return opts.category_colors[category] ?? categoricalColor(category);
}

function trajectoryColor(trajectory: Trajectory, opts: TrajectoryStyleOptions) {
  if (opts.style_mode === "single") return opts.line_color;
  const category = trajectoryCategoryValue(trajectory, opts.category_field);
  return opts.category_colors[category] ?? categoricalColor(category);
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

    if (
      hoverInfo.object &&
      !currentLayers.some(layer => layer.label === hoverInfo.layerLabel)
    ) {
      clearHoverInfo();
    }

    for (const [id, disposable] of layerDisposables) {
      if (!activeIds.has(id)) {
        disposable.dispose();
        layerDisposables.delete(id);
      }
    }

    for (const entry of currentLayers) {
      if (isFeatureLayerEntry(entry)) {
        const opts = entry.style;
        const data = filteredFeatureCollection(
          entry.source,
          opts.category_field,
          opts.hidden_categories
        );
        const deckLayer = new GeoJsonLayer({
          id: `explore-layer-${entry.id}`,
          data: data as never,
          visible: entry.visible,
          pickable: opts.pickable,
          opacity: opts.opacity,
          stroked: opts.stroked,
          filled: opts.filled,
          extruded: opts.extruded,
          pointRadiusMinPixels: opts.point_radius,
          lineWidthMinPixels: opts.line_width,
          getFillColor: (feature: unknown) =>
            parseColorSpec(featureColor(feature as GeoJsonFeature, opts)) ??
            defaultFeatureFillColor(),
          getLineColor: (feature: unknown) =>
            parseColorSpec(
              opts.style_mode === "single"
                ? opts.line_color
                : featureColor(feature as GeoJsonFeature, opts)
            ) ?? defaultFeatureLineColor(),
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
            getFillColor: [opts],
            getLineColor: [opts]
          }
        });

        if (!layerDisposables.has(entry.id)) {
          layerDisposables.set(
            entry.id,
            api.map.setLayer(deckLayer, {
              slot: "entities_underlay"
            })
          );
        } else {
          api.map.setLayer(deckLayer, {
            slot: "entities_underlay"
          });
        }
        continue;
      }

      if (isTrajectoryLayerEntry(entry)) {
        const opts = entry.style;
        const currentSelectedTrajectoryId = selectedTrajectoryIdForEntry(entry.id);
        const data = filteredTrajectories(
          entry.source,
          opts.category_field,
          opts.hidden_categories
        );
        const deckLayer = new PathLayer<Trajectory>({
          id: `explore-layer-${entry.id}`,
          data,
          visible: entry.visible,
          pickable: opts.pickable,
          opacity: opts.opacity,
          widthUnits: "pixels",
          widthMinPixels: opts.line_width,
          getPath: trajectory =>
            trajectory.points.map<[number, number, number]>(point => [
              point.longitude,
              point.latitude,
              is3d ? (point.altitude ?? 0) : 0
            ]),
          getColor: trajectory => {
            if (trajectory.id === currentSelectedTrajectoryId) {
              return SELECTED_TRAJECTORY_COLOR;
            }
            return (
              parseColorSpec(trajectoryColor(trajectory, opts)) ??
              defaultFeatureLineColor()
            );
          },
          getWidth: trajectory =>
            trajectory.id === currentSelectedTrajectoryId
              ? opts.line_width + 2
              : opts.line_width,
          onHover: (info: PickingInfo<Trajectory>) => {
            if (info.object) {
              hoverInfo.object = info.object.properties;
              hoverInfo.x = info.x;
              hoverInfo.y = info.y;
              hoverInfo.layerLabel = entry.label;
            } else {
              hoverInfo.object = null;
            }
          },
          onClick: (info: PickingInfo<Trajectory>) => {
            if (!info.object) return false;

            // NOTE: we intentionally store selected imported trajectories in
            // local explore state rather than pushing them into
            // `api.state.setEntity`.
            //
            // Tangram's core StateApi is currently optimised for live, realtime
            // telemetry. Injecting ephemeral, historical datasets into the live
            // pool causes widget misbehavior and memory leaks.
            //
            // TODO: once core implements a unified history/timeline api
            // this local state should be removed and handled by core.
            selectExploreTrajectory(entry.id, info.object);
            return true;
          },
          updateTriggers: {
            getPath: [is3d],
            getColor: [opts, currentSelectedTrajectoryId],
            getWidth: [opts.line_width, currentSelectedTrajectoryId]
          }
        });

        if (!layerDisposables.has(entry.id)) {
          layerDisposables.set(
            entry.id,
            api.map.setLayer(deckLayer, {
              slot: "tracks"
            })
          );
        } else {
          api.map.setLayer(deckLayer, {
            slot: "tracks"
          });
        }
        continue;
      }

      const table = entry.source.table;
      const coordinates = entry.source.coordinates;
      if (entry.source.variant !== "point-table" || !coordinates) continue;

      const latData = table.getChild(coordinates.latitudeField)!;
      const lonData = table.getChild(coordinates.longitudeField)!;
      const altData =
        is3d && coordinates.altitudeField
          ? table.getChild(coordinates.altitudeField)
          : null;
      const opts = entry.style;
      const deckLayer = new ScatterplotLayer({
        id: `explore-layer-${entry.id}`,
        data: { length: table.numRows },
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
        getFillColor: parseColorSpec(opts.fill_color) ?? defaultTableFillColor(),
        getLineColor: parseColorSpec(opts.line_color) ?? defaultTableLineColor(),
        onHover: (info: PickingInfo) => {
          if (info.index !== -1) {
            const row = table.get(info.index);
            hoverInfo.object = row ? row.toJSON() : null;
            hoverInfo.x = info.x;
            hoverInfo.y = info.y;
            hoverInfo.layerLabel = entry.label;
          } else {
            clearHoverInfo();
          }
        },
        updateTriggers: {
          getPosition: [entry.id, is3d],
          getFillColor: [opts.fill_color],
          getLineColor: [opts.line_color]
        }
      });

      if (!layerDisposables.has(entry.id)) {
        layerDisposables.set(
          entry.id,
          api.map.setLayer(deckLayer, {
            slot: "entities_underlay"
          })
        );
      } else {
        api.map.setLayer(deckLayer, {
          slot: "entities_underlay"
        });
      }
    }
  },
  { deep: true }
);

onUnmounted(() => {
  clearHoverInfo();
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
  background: var(--t-surface);
  color: var(--t-fg);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(12px, 12px);
  z-index: 2000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
  border: 1px solid var(--t-border);
  max-width: 250px;
}

.tooltip-header {
  font-weight: bold;
  padding-bottom: 4px;
  color: var(--t-fg);
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
  color: var(--t-muted);
}
</style>
