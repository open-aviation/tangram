import type { LazyImportFile } from "@open-aviation/tangram-core/api";
import {
  finiteNumber,
  isRecord,
  parseJsonlRows,
  parseTimestamp
} from "@open-aviation/tangram-core/utils";
import {
  createTrajectorySource,
  type Trajectory,
  type TrajectoryPoint,
  type TrajectorySample
} from "./trajectory_source";

export {
  finiteNumber,
  isRecord,
  parseCsvRows,
  parseJsonlRows,
  parseTimestamp
} from "@open-aviation/tangram-core/utils";

export interface TrajectoryImportOptions {
  idFields: string[];
  latitudeFields: string[];
  longitudeFields: string[];
  timestampFields: string[];
  altitudeFields?: string[];
  speedFields?: string[];
  headingFields?: string[];
  trackFields?: string[];
  splitThresholdSeconds: number;
  defaultProperties: Record<string, unknown>;
}

const TRAJECTORY_FIELD_CANDIDATES = {
  id: [
    "icao24",
    "callsign",
    "flight_id",
    "flight",
    "mmsi",
    "registration",
    "tail_number",
    "number",
    "id",
    "name"
  ],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng", "long"],
  timestamp: ["timestamp", "time", "datetime", "date", "utc", "seen", "lastseen"],
  altitude: ["altitude", "altitude_baro", "altitude_geom"],
  speed: ["groundspeed", "ground_speed", "speed", "velocity"],
  heading: ["heading", "direction", "course", "bearing"],
  track: ["track", "course", "direction", "heading"]
} as const;

function normalizeFieldName(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildFieldLookup(rows: Record<string, unknown>[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) {
      const normalized = normalizeFieldName(key);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, key);
      }
    }
  }
  return lookup;
}

function resolveFieldCandidates(
  lookup: Map<string, string>,
  candidates: readonly string[]
): string[] {
  return candidates
    .map(candidate => lookup.get(normalizeFieldName(candidate)))
    .filter((value): value is string => value !== undefined);
}

function positionPart(row: Record<string, unknown>, index: 0 | 1): number | null {
  const value = row.Position ?? row.position;
  if (typeof value !== "string") return null;
  const parts = value.split(",").map(part => part.trim());
  return finiteNumber(parts[index]);
}

function normalizeFlightRadarTrackJson(
  value: Record<string, unknown>,
  fallbackId: string
): Record<string, unknown>[] | null {
  if (!Array.isArray(value.track)) {
    return null;
  }

  const identification = isRecord(value.identification) ? value.identification : {};
  const number = isRecord(identification.number)
    ? identification.number.default
    : undefined;
  const callsign = identification.callsign ?? number ?? fallbackId;

  return value.track.filter(isRecord).map(row => ({
    callsign,
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: row.timestamp,
    altitude: isRecord(row.altitude) ? row.altitude.feet : row.altitude,
    speed: isRecord(row.speed) ? row.speed.kts : row.speed,
    vertical_rate: isRecord(row.verticalSpeed)
      ? row.verticalSpeed.fpm
      : row.verticalSpeed,
    heading: row.heading,
    track: row.heading
  }));
}

export function extractTrajectoryJsonRows(
  value: unknown,
  fallbackId: string
): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    const rows = value.filter(isRecord);
    return rows.length > 0 ? rows : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const normalizedTrackRows = normalizeFlightRadarTrackJson(value, fallbackId);
  if (normalizedTrackRows && normalizedTrackRows.length > 0) {
    return normalizedTrackRows;
  }

  for (const key of ["rows", "data", "points", "records", "trajectory", "positions"]) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) continue;
    const rows = candidate.filter(isRecord);
    if (rows.length > 0) {
      return rows;
    }
  }

  return null;
}

export function detectTrajectoryOptions(
  rows: Record<string, unknown>[],
  defaultProperties: Record<string, unknown>,
  splitThresholdSeconds = 600
): TrajectoryImportOptions | null {
  if (rows.length === 0) return null;

  const lookup = buildFieldLookup(rows);
  const latitudeFields = resolveFieldCandidates(
    lookup,
    TRAJECTORY_FIELD_CANDIDATES.latitude
  );
  const longitudeFields = resolveFieldCandidates(
    lookup,
    TRAJECTORY_FIELD_CANDIDATES.longitude
  );
  const hasCoordinates =
    (latitudeFields.length > 0 && longitudeFields.length > 0) || lookup.has("position");

  if (!hasCoordinates) {
    return null;
  }

  return {
    idFields: resolveFieldCandidates(lookup, TRAJECTORY_FIELD_CANDIDATES.id),
    latitudeFields,
    longitudeFields,
    timestampFields: resolveFieldCandidates(
      lookup,
      TRAJECTORY_FIELD_CANDIDATES.timestamp
    ),
    altitudeFields: resolveFieldCandidates(
      lookup,
      TRAJECTORY_FIELD_CANDIDATES.altitude
    ),
    speedFields: resolveFieldCandidates(lookup, TRAJECTORY_FIELD_CANDIDATES.speed),
    headingFields: resolveFieldCandidates(lookup, TRAJECTORY_FIELD_CANDIDATES.heading),
    trackFields: resolveFieldCandidates(lookup, TRAJECTORY_FIELD_CANDIDATES.track),
    splitThresholdSeconds,
    defaultProperties
  };
}

export async function jsonlSample(
  file: Pick<LazyImportFile, "rawFile" | "getText">
): Promise<Record<string, unknown>[]> {
  return parseJsonlRows(file, 20, true);
}

export function rowsToTrajectories(
  rows: Record<string, unknown>[],
  options: TrajectoryImportOptions
): Trajectory[] {
  const groups = new Map<
    string,
    {
      point: TrajectoryPoint | null;
      sample: TrajectorySample;
      row: Record<string, unknown>;
    }[]
  >();

  const first = (row: Record<string, unknown>, fields: string[]) =>
    fields
      .map(field => row[field])
      .find(value => value !== undefined && value !== null);

  for (const row of rows) {
    const latitude =
      finiteNumber(first(row, options.latitudeFields)) ?? positionPart(row, 0);
    const longitude =
      finiteNumber(first(row, options.longitudeFields)) ?? positionPart(row, 1);
    const idValue = first(row, options.idFields) ?? "trajectory";
    const id = String(idValue).trim() || "trajectory";
    const timestamp = parseTimestamp(first(row, options.timestampFields));
    const altitude = finiteNumber(first(row, options.altitudeFields ?? []));
    const speed = finiteNumber(first(row, options.speedFields ?? []));
    const heading = finiteNumber(first(row, options.headingFields ?? []));
    const sample: TrajectorySample = {
      timestamp,
      latitude,
      longitude,
      altitude,
      speed,
      track: finiteNumber(first(row, options.trackFields ?? [])) ?? heading,
      heading,
      raw: row
    };

    const hasPlotValue = [altitude, speed, sample.track, sample.heading].some(
      value => value !== null && value !== undefined
    );

    if ((latitude === null || longitude === null) && !hasPlotValue) continue;

    const point: TrajectoryPoint | null =
      latitude !== null && longitude !== null
        ? {
            latitude,
            longitude,
            timestamp,
            altitude,
            speed,
            heading: sample.track ?? heading
          }
        : null;

    const bucket = groups.get(id) ?? [];
    bucket.push({ point, sample, row });
    groups.set(id, bucket);
  }

  const trajectories: Trajectory[] = [];
  for (const [id, entries] of groups) {
    entries.sort(
      (left, right) => (left.sample.timestamp ?? 0) - (right.sample.timestamp ?? 0)
    );

    let segment: typeof entries = [];
    let segmentIndex = 1;
    const flush = () => {
      const points = segment
        .map(entry => entry.point)
        .filter((point): point is TrajectoryPoint => point !== null);
      if (points.length < 2) return;

      const properties: Record<string, unknown> = { ...options.defaultProperties, id };
      for (const field of options.idFields) {
        const value = segment
          .map(entry => entry.row[field])
          .find(
            item => item !== undefined && item !== null && String(item).trim() !== ""
          );
        if (value !== undefined && value !== null) properties[field] = value;
      }

      const samples = segment.map(entry => entry.sample);
      const timestamps = samples
        .map(sample => sample.timestamp)
        .filter((value): value is number => value !== null);
      trajectories.push({
        id: segmentIndex === 1 ? id : `${id}-${segmentIndex}`,
        label: segmentIndex === 1 ? id : `${id} (${segmentIndex})`,
        points,
        samples,
        properties,
        start: timestamps.length > 0 ? Math.min(...timestamps) : null,
        stop: timestamps.length > 0 ? Math.max(...timestamps) : null
      });
      segmentIndex += 1;
    };

    for (const entry of entries) {
      const previous = segment.length > 0 ? segment[segment.length - 1] : undefined;
      const gapSeconds =
        previous &&
        previous.sample.timestamp !== null &&
        entry.sample.timestamp !== null
          ? entry.sample.timestamp - previous.sample.timestamp
          : 0;
      if (segment.length > 0 && gapSeconds > options.splitThresholdSeconds) {
        flush();
        segment = [];
      }
      segment.push(entry);
    }

    flush();
  }

  return trajectories;
}

export function createTrajectorySourceFromRows(
  rows: Record<string, unknown>[],
  options: TrajectoryImportOptions
) {
  return createTrajectorySource(rowsToTrajectories(rows, options));
}
