import type {
  LazyImportFile,
  WorkspaceDatasetEntry,
  WorkspaceDatasetInput
} from "@open-aviation/tangram-core/api";
import {
  computeBoundsFromRecords,
  finiteNumber,
  latestTrajectoryPoints,
  parseJsonlRows,
  parseTimestamp,
  segmentTrajectoryRecords
} from "@open-aviation/tangram-core/utils";
import type { Ship162Vessel } from ".";

export const SHIP162_IMPORTED_HISTORY_KIND = "ship162_imported_history";

export interface Ship162ImportedPayload {
  tracks: Ship162Vessel[][];
  latestPoints: Ship162Vessel[];
  recordCount: number;
}

export type Ship162ImportedHistoryEntry =
  WorkspaceDatasetEntry<Ship162ImportedPayload> & {
    kind: typeof SHIP162_IMPORTED_HISTORY_KIND;
    payload: Ship162ImportedPayload;
  };

function normalizeShip162Row(row: Record<string, unknown>): Ship162Vessel | null {
  const mmsi = String(row.mmsi ?? "").trim();
  if (!mmsi) return null;

  const latitude = finiteNumber(row.lat ?? row.latitude);
  const longitude = finiteNumber(row.lon ?? row.longitude);
  if (latitude === null || longitude === null) return null;

  return {
    mmsi,
    timestamp: parseTimestamp(row.timestamp) ?? undefined,
    lastseen: parseTimestamp(row.lastseen) ?? undefined,
    latitude,
    longitude,
    ship_name: String(row.ship_name ?? row.name ?? "").trim() || undefined,
    course: finiteNumber(row.course) ?? undefined,
    speed: finiteNumber(row.speed) ?? undefined,
    destination: String(row.destination ?? "").trim() || undefined,
    ship_type: String(row.ship_type ?? "").trim() || undefined,
    status: String(row.status ?? "").trim() || undefined,
    callsign: String(row.callsign ?? "").trim() || undefined,
    heading: finiteNumber(row.heading) ?? undefined,
    imo: finiteNumber(row.imo) ?? undefined,
    draught: finiteNumber(row.draught) ?? undefined,
    to_bow: finiteNumber(row.to_bow) ?? undefined,
    to_stern: finiteNumber(row.to_stern) ?? undefined,
    to_port: finiteNumber(row.to_port) ?? undefined,
    to_starboard: finiteNumber(row.to_starboard) ?? undefined,
    turn: finiteNumber(row.turn) ?? undefined
  };
}

export function importedShipTimestamp(record: Ship162Vessel): number | null {
  return record.timestamp ?? record.lastseen ?? null;
}

export function importedShipTrackCount(payload: Ship162ImportedPayload): number {
  return payload.tracks.length;
}

export function importedShipRecordCount(payload: Ship162ImportedPayload): number {
  return payload.recordCount;
}

function buildImportedPayload(
  records: ReadonlyArray<Ship162Vessel>
): Ship162ImportedPayload {
  const tracks = segmentTrajectoryRecords(records, {
    getId: record => record.mmsi || record.callsign,
    getTimestamp: importedShipTimestamp,
    maxGapSeconds: 3600,
    fallbackId: "ship"
  });

  return {
    tracks,
    // HACK: we cache the terminal sample of each segmented track so the live ship layer
    // can place a static icon for imported history
    latestPoints: latestTrajectoryPoints(tracks),
    recordCount: records.length
  };
}

export function isShip162ImportedHistoryDataset(
  entry: WorkspaceDatasetEntry
): entry is Ship162ImportedHistoryEntry {
  const payload = entry.payload;
  return (
    (entry as { kind?: unknown }).kind === SHIP162_IMPORTED_HISTORY_KIND &&
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as Ship162ImportedPayload).tracks) &&
    Array.isArray((payload as Ship162ImportedPayload).latestPoints)
  );
}

export async function acceptsShip162Jsonl(file: LazyImportFile): Promise<boolean> {
  if (file.metadata.extension !== ".jsonl") return false;
  const sample = await parseJsonlRows(file, 20, true);
  return sample.some(
    row =>
      "mmsi" in row &&
      ("lat" in row || "latitude" in row) &&
      ("lon" in row || "longitude" in row)
  );
}

export async function parseShip162Jsonl(
  file: LazyImportFile
): Promise<WorkspaceDatasetInput[]> {
  const records = (await parseJsonlRows(file))
    .map(normalizeShip162Row)
    .filter((record): record is Ship162Vessel => record !== null);

  if (records.length === 0) {
    throw new Error(`No valid ship history found in ${file.metadata.name}.`);
  }

  return [
    {
      kind: SHIP162_IMPORTED_HISTORY_KIND,
      label: file.metadata.name,
      payload: buildImportedPayload(records),
      bounds: computeBoundsFromRecords(
        records,
        record => record.longitude,
        record => record.latitude
      )
    }
  ];
}
