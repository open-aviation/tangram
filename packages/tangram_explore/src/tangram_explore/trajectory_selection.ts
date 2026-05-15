import { computed, ref, shallowRef } from "vue";
import type { Trajectory } from "./trajectory_source";

export interface ExploreTrajectorySelectionPayload {
  entryId: string;
  trajectoryId: string;
  layerLabel: string;
  properties: Record<string, unknown>;
  bounds: readonly [number, number, number, number] | null;
  pointCount: number;
  points: ReadonlyArray<Trajectory["points"][number]>;
}

function trajectoryInspectorProperties(
  trajectory: Trajectory
): Record<string, unknown> {
  return {
    ...trajectory.properties,
    points: trajectory.points.length,
    samples: trajectory.samples.length,
    start:
      trajectory.start !== null
        ? new Date(trajectory.start * 1000).toISOString()
        : null,
    stop:
      trajectory.stop !== null ? new Date(trajectory.stop * 1000).toISOString() : null
  };
}

function trajectoryBounds(
  trajectory: Trajectory
): readonly [number, number, number, number] | null {
  if (trajectory.points.length === 0) return null;

  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const point of trajectory.points) {
    minLon = Math.min(minLon, point.longitude);
    minLat = Math.min(minLat, point.latitude);
    maxLon = Math.max(maxLon, point.longitude);
    maxLat = Math.max(maxLat, point.latitude);
  }

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [minLon, minLat, maxLon, maxLat];
}

export function exploreTrajectoryKey(entryId: string, trajectoryId: string): string {
  return JSON.stringify([entryId, trajectoryId]);
}

export function buildExploreTrajectorySelectionPayload(
  entryId: string,
  layerLabel: string,
  trajectory: Trajectory
): ExploreTrajectorySelectionPayload {
  return {
    entryId,
    trajectoryId: trajectory.id,
    layerLabel,
    properties: trajectoryInspectorProperties(trajectory),
    bounds: trajectoryBounds(trajectory),
    pointCount: trajectory.points.length,
    points: trajectory.points
  };
}

export const selectedTrajectoryKey = ref<string | null>(null);
export const exploreTrajectoryRecords = shallowRef<
  ReadonlyMap<string, ExploreTrajectorySelectionPayload>
>(new Map());

const trajectoryKeysByEntry = new Map<string, string[]>();

export function addExploreTrajectoryLayer(
  entryId: string,
  layerLabel: string,
  trajectories: ReadonlyArray<Trajectory>
): void {
  const records = new Map(exploreTrajectoryRecords.value);
  const previousKeys = trajectoryKeysByEntry.get(entryId) ?? [];

  for (const key of previousKeys) {
    records.delete(key);
  }

  const nextKeys: string[] = [];
  for (const trajectory of trajectories) {
    const key = exploreTrajectoryKey(entryId, trajectory.id);
    nextKeys.push(key);
    records.set(
      key,
      buildExploreTrajectorySelectionPayload(entryId, layerLabel, trajectory)
    );
  }

  trajectoryKeysByEntry.set(entryId, nextKeys);
  exploreTrajectoryRecords.value = records;

  if (selectedTrajectoryKey.value && !records.has(selectedTrajectoryKey.value)) {
    selectedTrajectoryKey.value = null;
  }
}

export function removeExploreTrajectoryLayer(entryId: string): void {
  const keys = trajectoryKeysByEntry.get(entryId);
  if (!keys) return;

  const records = new Map(exploreTrajectoryRecords.value);
  for (const key of keys) {
    records.delete(key);
  }

  trajectoryKeysByEntry.delete(entryId);
  exploreTrajectoryRecords.value = records;

  if (selectedTrajectoryKey.value && !records.has(selectedTrajectoryKey.value)) {
    selectedTrajectoryKey.value = null;
  }
}

export function clearExploreTrajectoryLayers(): void {
  trajectoryKeysByEntry.clear();
  exploreTrajectoryRecords.value = new Map();
  selectedTrajectoryKey.value = null;
}

export const selectedTrajectory = computed(() => {
  const key = selectedTrajectoryKey.value;
  if (!key) return null;
  return exploreTrajectoryRecords.value.get(key) ?? null;
});

export const hasSelectedTrajectory = computed(() => selectedTrajectory.value !== null);

export function selectExploreTrajectory(entryId: string, trajectory: Trajectory): void {
  const key = exploreTrajectoryKey(entryId, trajectory.id);
  selectedTrajectoryKey.value = exploreTrajectoryRecords.value.has(key) ? key : null;
}

export function clearExploreTrajectory(): void {
  selectedTrajectoryKey.value = null;
}

export function selectedTrajectoryIdForEntry(entryId: string): string | null {
  const current = selectedTrajectory.value;
  if (!current || current.entryId !== entryId) return null;
  return current.trajectoryId;
}
