import { reactive, shallowRef, triggerRef, ref } from "vue";
import type { Table } from "apache-arrow";
import type { Table as WasmTable } from "parquet-wasm";
import type { ColorSpec } from "@open-aviation/tangram-core/utils";
import type { FeatureSource } from "./feature_source";
import { createTableSource, type TableSource } from "./table_source";
import type { TrajectorySource } from "./trajectory_source";
import {
  addExploreTrajectoryLayer,
  clearExploreTrajectoryLayers,
  removeExploreTrajectoryLayer
} from "./trajectory_selection";

export interface ScatterOptions {
  kind: "scatter";
  radius_scale: number;
  radius_min_pixels: number;
  radius_max_pixels: number;
  line_width_min_pixels: number;
  fill_color: ColorSpec;
  line_color: ColorSpec;
  opacity: number;
  stroked: boolean;
  filled: boolean;
  pickable: boolean;
}

export type FeatureStyleMode = "single" | "category";
export type TrajectoryStyleMode = "single" | "category";

export interface FeatureStyleOptions {
  kind: "feature";
  fill_color: ColorSpec;
  line_color: ColorSpec;
  point_radius: number;
  line_width: number;
  opacity: number;
  stroked: boolean;
  filled: boolean;
  extruded: boolean;
  pickable: boolean;
  style_mode: FeatureStyleMode;
  color_field: string;
  category_field: string;
  category_colors: Record<string, string>;
  hidden_categories: Record<string, boolean>;
}

export interface TrajectoryStyleOptions {
  kind: "trajectory";
  line_color: ColorSpec;
  line_width: number;
  opacity: number;
  pickable: boolean;
  style_mode: TrajectoryStyleMode;
  category_field: string;
  category_colors: Record<string, string>;
  hidden_categories: Record<string, boolean>;
}

export type StyleOptions =
  | ScatterOptions
  | FeatureStyleOptions
  | TrajectoryStyleOptions;

export interface TableLayerEntry {
  id: string;
  label: string;
  source: TableSource;
  style: ScatterOptions;
  visible: boolean;
}

export interface FeatureLayerEntry {
  id: string;
  label: string;
  source: FeatureSource;
  style: FeatureStyleOptions;
  visible: boolean;
}

export interface TrajectoryLayerEntry {
  id: string;
  label: string;
  source: TrajectorySource;
  style: TrajectoryStyleOptions;
  visible: boolean;
}

export type LayerEntry = TableLayerEntry | FeatureLayerEntry | TrajectoryLayerEntry;

export const layers = shallowRef<LayerEntry[]>([]);
export const activeLayerId = ref<string | null>(null);

export const pluginConfig = reactive({
  enable_3d: false
});

const FALLBACK_ACCENT_COLOR = "oklch(0.5616 0.0895 251.64)";

function createDefaultScatterStyle(): ScatterOptions {
  return {
    kind: "scatter",
    radius_scale: 50,
    radius_min_pixels: 2,
    radius_max_pixels: 5,
    line_width_min_pixels: 1,
    fill_color: FALLBACK_ACCENT_COLOR,
    line_color: FALLBACK_ACCENT_COLOR,
    opacity: 0.8,
    stroked: false,
    filled: true,
    pickable: true
  };
}

export function addTableLayer(
  id: string,
  label: string,
  source: TableSource,
  style: ScatterOptions
) {
  if (layers.value.some(d => d.id === id)) return;
  layers.value.push({
    id,
    label,
    source,
    style,
    visible: true
  });
  triggerRef(layers);
}

export function addServerTableLayer(
  id: string,
  label: string,
  table: Table,
  wasmRef: WasmTable,
  style: ScatterOptions
) {
  addTableLayer(
    id,
    label,
    createTableSource(table, () => wasmRef.free()),
    style
  );
}

function createDefaultTrajectoryStyle(
  source: TrajectorySource
): TrajectoryStyleOptions {
  const categoryField = source.styleHints.categoryField;
  return {
    kind: "trajectory",
    line_color: FALLBACK_ACCENT_COLOR,
    line_width: 2,
    opacity: 0.85,
    pickable: true,
    style_mode: categoryField ? "category" : "single",
    category_field: categoryField,
    category_colors: source.styleHints.categoryColors,
    hidden_categories: {}
  };
}

function createDefaultFeatureStyle(source: FeatureSource): FeatureStyleOptions {
  const colorField = source.styleHints.colorField;

  return {
    kind: "feature",
    fill_color: FALLBACK_ACCENT_COLOR,
    line_color: FALLBACK_ACCENT_COLOR,
    point_radius: 4,
    line_width: 2,
    opacity: 0.75,
    stroked: true,
    filled: true,
    extruded: false,
    pickable: true,
    style_mode: colorField ? "category" : "single",
    color_field: colorField,
    category_field: colorField,
    category_colors: source.styleHints.categoryColors,
    hidden_categories: {}
  };
}

export function addFeatureLayer(label: string, source: FeatureSource) {
  const id = crypto.randomUUID();
  layers.value.push({
    id,
    label,
    source,
    visible: true,
    style: createDefaultFeatureStyle(source)
  });
  triggerRef(layers);
}

export function addTrajectoryLayer(label: string, source: TrajectorySource) {
  const id = crypto.randomUUID();
  layers.value.push({
    id,
    label,
    source,
    visible: true,
    style: createDefaultTrajectoryStyle(source)
  });
  addExploreTrajectoryLayer(id, label, source.trajectories);
  triggerRef(layers);
}

export function addSourceLayer(
  label: string,
  source: FeatureSource | TableSource | TrajectorySource
) {
  if (source.kind === "features") {
    addFeatureLayer(label, source);
    return;
  }

  if (source.kind === "trajectories") {
    addTrajectoryLayer(label, source);
    return;
  }

  addTableLayer(crypto.randomUUID(), label, source, createDefaultScatterStyle());
}

function disposeLayer(entry: LayerEntry) {
  if (entry.source.kind === "table") {
    entry.source.dispose();
  }
}

export function removeLayer(id: string) {
  const idx = layers.value.findIndex(d => d.id === id);
  if (idx !== -1) {
    if (layers.value[idx].source.kind === "trajectories") {
      removeExploreTrajectoryLayer(layers.value[idx].id);
    }
    disposeLayer(layers.value[idx]);
    layers.value.splice(idx, 1);
    triggerRef(layers);
  }
}

export function clearLayers() {
  clearExploreTrajectoryLayers();
  layers.value.forEach(disposeLayer);
  layers.value = [];
  triggerRef(layers);
}

export function toggleLayerVisibility(id: string) {
  const layer = layers.value.find(d => d.id === id);
  if (layer) {
    layer.visible = !layer.visible;
    triggerRef(layers);
  }
}

export function updateFeatureStyle(
  layer: FeatureLayerEntry,
  patch: Partial<FeatureStyleOptions>
) {
  layer.style = { ...layer.style, ...patch };
  triggerRef(layers);
}

export function setFeatureCategoryColor(
  layer: FeatureLayerEntry,
  category: string,
  color: string
) {
  layer.style = {
    ...layer.style,
    category_colors: {
      ...layer.style.category_colors,
      [category]: color
    }
  };
  triggerRef(layers);
}

export function toggleFeatureCategory(layer: FeatureLayerEntry, category: string) {
  layer.style = {
    ...layer.style,
    hidden_categories: {
      ...layer.style.hidden_categories,
      [category]: !layer.style.hidden_categories[category]
    }
  };
  triggerRef(layers);
}

export function updateTrajectoryStyle(
  layer: TrajectoryLayerEntry,
  patch: Partial<TrajectoryStyleOptions>
) {
  layer.style = { ...layer.style, ...patch };
  triggerRef(layers);
}

export function setTrajectoryCategoryColor(
  layer: TrajectoryLayerEntry,
  category: string,
  color: string
) {
  layer.style = {
    ...layer.style,
    category_colors: {
      ...layer.style.category_colors,
      [category]: color
    }
  };
  triggerRef(layers);
}

export function toggleTrajectoryCategory(
  layer: TrajectoryLayerEntry,
  category: string
) {
  layer.style = {
    ...layer.style,
    hidden_categories: {
      ...layer.style.hidden_categories,
      [category]: !layer.style.hidden_categories[category]
    }
  };
  triggerRef(layers);
}
