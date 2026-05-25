import type {
  WorkspaceDatasetEntry,
  WorkspaceDatasetInput
} from "@open-aviation/tangram-core/api";
import type { ColorSpec } from "@open-aviation/tangram-core/utils";
import type { FeatureSource } from "./feature_source";
import type { TableSource } from "./table_source";
import type { TrajectorySource } from "./trajectory_source";

const FALLBACK_ACCENT_COLOR = "oklch(0.5616 0.0895 251.64)";

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

export type ExploreStyleOptions =
  | ScatterOptions
  | FeatureStyleOptions
  | TrajectoryStyleOptions;

export type FeatureDatasetEntry = WorkspaceDatasetEntry<FeatureSource> & {
  kind: "features";
  payload: FeatureSource;
  style: FeatureStyleOptions;
};

export type TableDatasetEntry = WorkspaceDatasetEntry<TableSource> & {
  kind: "table";
  payload: TableSource;
  style: ScatterOptions;
};

export type TrajectoryDatasetEntry = WorkspaceDatasetEntry<TrajectorySource> & {
  kind: "trajectories";
  payload: TrajectorySource;
  style: TrajectoryStyleOptions;
};

export type ExploreDatasetEntry =
  | FeatureDatasetEntry
  | TableDatasetEntry
  | TrajectoryDatasetEntry;

export type FeatureDatasetInput = WorkspaceDatasetInput<FeatureSource> & {
  kind: "features";
  style: FeatureStyleOptions;
};

export type TableDatasetInput = WorkspaceDatasetInput<TableSource> & {
  kind: "table";
  style: ScatterOptions;
};

export type TrajectoryDatasetInput = WorkspaceDatasetInput<TrajectorySource> & {
  kind: "trajectories";
  style: TrajectoryStyleOptions;
};

export type ExploreDatasetInput =
  | FeatureDatasetInput
  | TableDatasetInput
  | TrajectoryDatasetInput;

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

export function createFeatureDatasetInput(
  label: string,
  source: FeatureSource,
  options: Partial<
    Omit<FeatureDatasetInput, "kind" | "label" | "payload" | "bounds">
  > = {}
): FeatureDatasetInput {
  return {
    kind: "features",
    label,
    payload: source,
    bounds: source.bounds,
    style: options.style ?? createDefaultFeatureStyle(source),
    pluginId: options.pluginId,
    id: options.id,
    visible: options.visible,
    dispose: options.dispose
  };
}

export function createTableDatasetInput(
  label: string,
  source: TableSource,
  options: Partial<
    Omit<TableDatasetInput, "kind" | "label" | "payload" | "bounds" | "dispose">
  > = {}
): TableDatasetInput {
  return {
    kind: "table",
    label,
    payload: source,
    bounds: source.bounds,
    style: options.style ?? createDefaultScatterStyle(),
    pluginId: options.pluginId,
    id: options.id,
    visible: options.visible,
    dispose: source.dispose
  };
}

export function createTrajectoryDatasetInput(
  label: string,
  source: TrajectorySource,
  options: Partial<
    Omit<TrajectoryDatasetInput, "kind" | "label" | "payload" | "bounds">
  > = {}
): TrajectoryDatasetInput {
  return {
    kind: "trajectories",
    label,
    payload: source,
    bounds: source.bounds,
    style: options.style ?? createDefaultTrajectoryStyle(source),
    pluginId: options.pluginId,
    id: options.id,
    visible: options.visible,
    dispose: options.dispose
  };
}

export function isFeatureDatasetEntry(
  entry: WorkspaceDatasetEntry
): entry is FeatureDatasetEntry {
  return (entry as { kind?: unknown }).kind === "features";
}

export function isTableDatasetEntry(
  entry: WorkspaceDatasetEntry
): entry is TableDatasetEntry {
  return (entry as { kind?: unknown }).kind === "table";
}

export function isTrajectoryDatasetEntry(
  entry: WorkspaceDatasetEntry
): entry is TrajectoryDatasetEntry {
  return (entry as { kind?: unknown }).kind === "trajectories";
}

export function isExploreDatasetEntry(
  entry: WorkspaceDatasetEntry
): entry is ExploreDatasetEntry {
  return (
    isFeatureDatasetEntry(entry) ||
    isTableDatasetEntry(entry) ||
    isTrajectoryDatasetEntry(entry)
  );
}
