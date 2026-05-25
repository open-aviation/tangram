import type {
  LazyImportFile,
  WorkspaceDatasetEntry,
  WorkspaceDatasetInput
} from "@open-aviation/tangram-core/api";
import {
  computeBoundsFromRecords,
  finiteNumber,
  isRecord,
  latestTrajectoryPoints,
  parseJsonlRows,
  parseTimestamp,
  segmentTrajectoryRecords
} from "@open-aviation/tangram-core/utils";
import type { Jet1090Aircraft } from ".";

export const JET1090_IMPORTED_HISTORY_KIND = "jet1090_imported_history";

export interface Jet1090ImportedPayload {
  flights: Jet1090Aircraft[][];
  latestPoints: Jet1090Aircraft[];
  recordCount: number;
}

export type Jet1090ImportedHistoryEntry =
  WorkspaceDatasetEntry<Jet1090ImportedPayload> & {
    kind: typeof JET1090_IMPORTED_HISTORY_KIND;
    payload: Jet1090ImportedPayload;
  };

function normalizeRs1090Row(row: Record<string, unknown>): Jet1090Aircraft | null {
  const icao24 = String(row.icao24 ?? "").trim();
  if (!icao24) return null;

  const latitude = finiteNumber(row.latitude ?? row.lat);
  const longitude = finiteNumber(row.longitude ?? row.lon ?? row.lng);
  if (latitude === null || longitude === null) return null;

  const bds20 = isRecord(row.bds20) ? row.bds20 : {};
  const bds50 = isRecord(row.bds50) ? row.bds50 : {};
  const bds60 = isRecord(row.bds60) ? row.bds60 : {};
  const timestamp = parseTimestamp(row.timestamp ?? row.lastseen);
  const lastseen =
    finiteNumber(row.lastseen) ?? Math.round((timestamp ?? 0) * 1_000_000);

  return {
    icao24,
    lastseen,
    callsign: String(row.callsign ?? bds20.callsign ?? "").trim() || undefined,
    registration: String(row.registration ?? "").trim() || undefined,
    typecode: String(row.typecode ?? "").trim() || undefined,
    squawk: finiteNumber(row.squawk) ?? undefined,
    latitude,
    longitude,
    altitude:
      finiteNumber(row.altitude ?? row.altitude_baro ?? row.altitude_geom) ?? undefined,
    selected_altitude: finiteNumber(row.selected_altitude) ?? undefined,
    groundspeed:
      finiteNumber(row.groundspeed ?? row.speed ?? bds50.groundspeed) ?? undefined,
    vertical_rate: finiteNumber(row.vertical_rate) ?? undefined,
    vrate_barometric:
      finiteNumber(row.vrate_barometric ?? bds60.vrate_barometric) ?? undefined,
    vrate_inertial:
      finiteNumber(row.vrate_inertial ?? bds60.vrate_inertial) ?? undefined,
    track: finiteNumber(row.track ?? bds50.track) ?? undefined,
    ias: finiteNumber(row.ias ?? row.IAS ?? bds60.ias ?? bds60.IAS) ?? undefined,
    tas: finiteNumber(row.tas ?? row.TAS ?? bds50.tas ?? bds50.TAS) ?? undefined,
    mach: finiteNumber(row.mach ?? row.Mach ?? bds60.mach ?? bds60.Mach) ?? undefined,
    roll: finiteNumber(row.roll ?? bds50.roll) ?? undefined,
    heading: finiteNumber(row.heading ?? bds60.heading) ?? undefined,
    nacp: finiteNumber(row.nacp) ?? undefined,
    count: 1,
    timestamp: timestamp ?? undefined
  };
}

export function importedAircraftTimestamp(record: Jet1090Aircraft): number | null {
  if (record.timestamp !== undefined) return record.timestamp;
  return Number.isFinite(record.lastseen) ? record.lastseen / 1_000_000 : null;
}

export function importedAircraftFlightCount(payload: Jet1090ImportedPayload): number {
  return payload.flights.length;
}

export function importedAircraftRecordCount(payload: Jet1090ImportedPayload): number {
  return payload.recordCount;
}

function buildImportedPayload(
  records: ReadonlyArray<Jet1090Aircraft>
): Jet1090ImportedPayload {
  const flights = segmentTrajectoryRecords(records, {
    getId: record => record.icao24 || record.callsign,
    getTimestamp: importedAircraftTimestamp,
    maxGapSeconds: 600,
    fallbackId: "aircraft"
  });

  return {
    flights,
    // HACK: we precompute one terminal point per segmented flight so the live aircraft
    // renderer can draw a static icon for imported history
    latestPoints: latestTrajectoryPoints(flights),
    recordCount: records.length
  };
}

export function isJet1090ImportedHistoryDataset(
  entry: WorkspaceDatasetEntry
): entry is Jet1090ImportedHistoryEntry {
  const payload = entry.payload;
  return (
    (entry as { kind?: unknown }).kind === JET1090_IMPORTED_HISTORY_KIND &&
    isRecord(payload) &&
    Array.isArray(payload.flights) &&
    Array.isArray(payload.latestPoints)
  );
}

export async function acceptsRs1090Jsonl(file: LazyImportFile): Promise<boolean> {
  if (file.metadata.extension !== ".jsonl") return false;
  const sample = await parseJsonlRows(file, 20, true);
  return sample.some(
    row => "icao24" in row && ("frame" in row || "bds" in row || "df" in row)
  );
}

export async function parseRs1090Jsonl(
  file: LazyImportFile
): Promise<WorkspaceDatasetInput[]> {
  const records = (await parseJsonlRows(file))
    .filter(row => ["17", "18", "20", "21"].includes(String(row.df)))
    .map(normalizeRs1090Row)
    .filter((record): record is Jet1090Aircraft => record !== null);

  if (records.length === 0) {
    throw new Error(`No valid flight history found in ${file.metadata.name}.`);
  }

  return [
    {
      kind: JET1090_IMPORTED_HISTORY_KIND,
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
