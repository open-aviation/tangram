import { categoricalColor } from "@open-aviation/tangram-core/utils";
import type { FeatureBounds } from "./feature_source";

export interface TrajectoryPoint {
  longitude: number;
  latitude: number;
  timestamp: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
}

export interface TrajectorySample {
  timestamp: number | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  selected_altitude?: number | null;
  speed?: number | null;
  ias?: number | null;
  tas?: number | null;
  mach?: number | null;
  vertical_rate?: number | null;
  vrate_barometric?: number | null;
  vrate_inertial?: number | null;
  heading?: number | null;
  track?: number | null;
  roll?: number | null;
  raw?: Record<string, unknown>;
}

export interface Trajectory {
  id: string;
  label: string;
  points: TrajectoryPoint[];
  samples: TrajectorySample[];
  properties: Record<string, unknown>;
  start: number | null;
  stop: number | null;
}

export interface TrajectorySource {
  kind: "trajectories";
  trajectories: Trajectory[];
  fields: string[];
  bounds: FeatureBounds | null;
  timeRange: { start: number; stop: number } | null;
  styleHints: {
    categoryField: string;
    categoryColors: Record<string, string>;
  };
  stats: {
    trajectoryCount: number;
    pointCount: number;
  };
}

export interface TrajectoryCategoryStat {
  value: string;
  count: number;
}

function extendBounds(point: TrajectoryPoint, bounds: FeatureBounds) {
  bounds.minLon = Math.min(bounds.minLon, point.longitude);
  bounds.minLat = Math.min(bounds.minLat, point.latitude);
  bounds.maxLon = Math.max(bounds.maxLon, point.longitude);
  bounds.maxLat = Math.max(bounds.maxLat, point.latitude);
}

function propertyValue(trajectory: Trajectory, field: string): string {
  if (!field) return "";
  const value = trajectory.properties[field];
  return value === undefined || value === null || value === ""
    ? "(empty)"
    : String(value);
}

function preferredCategoryField(fields: string[]): string {
  for (const preferred of ["callsign", "flight", "icao24", "mmsi", "id"]) {
    const match = fields.find(field => field.toLowerCase() === preferred);
    if (match) return match;
  }
  return fields[0] ?? "";
}

export function trajectoryCategoryValue(trajectory: Trajectory, field: string): string {
  return propertyValue(trajectory, field);
}

export function trajectoryStatsForField(
  source: TrajectorySource,
  field: string
): TrajectoryCategoryStat[] {
  if (!field) return [];
  const counts = new Map<string, number>();
  for (const trajectory of source.trajectories) {
    const category = trajectoryCategoryValue(trajectory, field);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

export function trajectoryColorsForField(
  source: TrajectorySource,
  field: string,
  existingColors: Record<string, string> = {}
): Record<string, string> {
  if (!field) return {};
  const colors: Record<string, string> = { ...existingColors };
  for (const stat of trajectoryStatsForField(source, field)) {
    colors[stat.value] ??= categoricalColor(stat.value);
  }
  return colors;
}

export function filteredTrajectories(
  source: TrajectorySource,
  field: string,
  hiddenCategories: Record<string, boolean>
): Trajectory[] {
  if (!field || Object.keys(hiddenCategories).length === 0) return source.trajectories;
  return source.trajectories.filter(
    trajectory => !hiddenCategories[trajectoryCategoryValue(trajectory, field)]
  );
}

export function createTrajectorySource(trajectories: Trajectory[]): TrajectorySource {
  const fieldsSet = new Set<string>();
  const bounds: FeatureBounds = {
    minLon: Number.POSITIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY
  };
  let pointCount = 0;
  let start = Number.POSITIVE_INFINITY;
  let stop = Number.NEGATIVE_INFINITY;

  for (const trajectory of trajectories) {
    for (const key of Object.keys(trajectory.properties)) fieldsSet.add(key);
    for (const point of trajectory.points) {
      pointCount += 1;
      extendBounds(point, bounds);
      if (point.timestamp !== null) {
        start = Math.min(start, point.timestamp);
        stop = Math.max(stop, point.timestamp);
      }
    }
  }

  const fields = [...fieldsSet].sort();
  const categoryField = preferredCategoryField(fields);
  const validBounds = [
    bounds.minLon,
    bounds.minLat,
    bounds.maxLon,
    bounds.maxLat
  ].every(Number.isFinite)
    ? bounds
    : null;
  const timeRange =
    Number.isFinite(start) && Number.isFinite(stop) ? { start, stop } : null;

  return {
    kind: "trajectories",
    trajectories,
    fields,
    bounds: validBounds,
    timeRange,
    styleHints: {
      categoryField,
      categoryColors: trajectoryColorsForField(
        {
          kind: "trajectories",
          trajectories,
          fields,
          bounds: validBounds,
          timeRange,
          styleHints: { categoryField, categoryColors: {} },
          stats: { trajectoryCount: trajectories.length, pointCount }
        },
        categoryField
      )
    },
    stats: {
      trajectoryCount: trajectories.length,
      pointCount
    }
  };
}
