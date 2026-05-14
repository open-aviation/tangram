import { feature as topoJsonFeature } from "topojson-client";
import type { Objects, Topology } from "topojson-specification";
import {
  createFeatureSourceFromGeoJson,
  type FeatureBounds,
  type FeatureSource
} from "./feature_source";
import type { TableSource } from "./table_source";
import {
  createTrajectorySource,
  type Trajectory,
  type TrajectoryPoint,
  type TrajectorySample,
  type TrajectorySource
} from "./trajectory_source";

const GEOJSON_GEOMETRY_TYPES = new Set<string>([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection"
]);

const JSON_MEDIA_TYPES = new Set(["", "application/json", "application/geo+json"]);

export type ImportedSource = FeatureSource | TableSource | TrajectorySource;

export interface ImportedLayer {
  label: string;
  source: ImportedSource;
  bounds: FeatureBounds | null;
}

interface FileMetadata {
  name: string;
  extension: string;
  mediaType: string;
}

class LazyImportFile {
  public metadata: FileMetadata;
  private _bytesPromise?: Promise<Uint8Array>;
  private _textPromise?: Promise<string>;
  private _jsonPromise?: Promise<unknown>;

  constructor(private file: File) {
    this.metadata = {
      name: file.name,
      extension: fileExtension(file.name),
      mediaType: file.type.toLowerCase()
    };
  }

  getBytes(): Promise<Uint8Array> {
    return (this._bytesPromise ??= this.file
      .arrayBuffer()
      .then(buf => new Uint8Array(buf)));
  }

  getText(): Promise<string> {
    return (this._textPromise ??= this.file.text());
  }

  getJson(): Promise<unknown> {
    return (this._jsonPromise ??= this.getText().then(JSON.parse));
  }
}

interface FileImporter {
  id: string;
  label: string;
  canImport: (file: LazyImportFile) => Promise<boolean>;
  importFile: (file: LazyImportFile) => Promise<ImportedLayer[]>;
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeTopoJson(value: unknown): value is Topology<Objects> {
  return isRecord(value) && value.type === "Topology" && isRecord(value.objects);
}

function looksLikeGeoJson(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "FeatureCollection") {
    return Array.isArray(value.features);
  }

  if (value.type === "Feature") {
    return true;
  }

  return typeof value.type === "string" && GEOJSON_GEOMETRY_TYPES.has(value.type);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Tangram trajectory widgets expect Unix timestamps in seconds.
    // Accept seconds, milliseconds, microseconds, or nanoseconds defensively.
    if (value > 10_000_000_000_000_000) return value / 1_000_000_000;
    if (value > 10_000_000_000_000) return value / 1_000_000;
    if (value > 10_000_000_000) return value / 1000;
    return value;
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return parseTimestamp(asNumber);
    const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  return null;
}

function csvFieldVariants(field: string): string[] {
  const variants = [field];
  const lower = field.toLowerCase();
  variants.push(lower);
  variants.push(field.charAt(0).toUpperCase() + field.slice(1).toLowerCase());
  return [...new Set(variants)];
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function positionPart(row: Record<string, unknown>, index: 0 | 1): number | null {
  const value = row.Position ?? row.position;
  if (typeof value !== "string") return null;
  const parts = value.split(",").map(part => part.trim());
  return finiteNumber(parts[index]);
}

function rowsToTrajectories(
  rows: Record<string, unknown>[],
  options: {
    idFields: string[];
    latitudeFields: string[];
    longitudeFields: string[];
    timestampFields: string[];
    altitudeFields?: string[];
    speedFields?: string[];
    headingFields?: string[];
    selectedAltitudeFields?: string[];
    iasFields?: string[];
    tasFields?: string[];
    machFields?: string[];
    verticalRateFields?: string[];
    verticalRateBarometricFields?: string[];
    verticalRateInertialFields?: string[];
    trackFields?: string[];
    rollFields?: string[];
    splitThresholdSeconds: number;
    defaultProperties: Record<string, unknown>;
  }
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
      selected_altitude: finiteNumber(first(row, options.selectedAltitudeFields ?? [])),
      speed,
      ias: finiteNumber(first(row, options.iasFields ?? [])),
      tas: finiteNumber(first(row, options.tasFields ?? [])),
      mach: finiteNumber(first(row, options.machFields ?? [])),
      vertical_rate: finiteNumber(first(row, options.verticalRateFields ?? [])),
      vrate_barometric: finiteNumber(
        first(row, options.verticalRateBarometricFields ?? [])
      ),
      vrate_inertial: finiteNumber(
        first(row, options.verticalRateInertialFields ?? [])
      ),
      track: finiteNumber(first(row, options.trackFields ?? [])) ?? heading,
      heading,
      roll: finiteNumber(first(row, options.rollFields ?? [])),
      raw: row
    };
    const hasPlotValue = [
      altitude,
      sample.selected_altitude,
      speed,
      sample.ias,
      sample.tas,
      sample.mach,
      sample.vertical_rate,
      sample.vrate_barometric,
      sample.vrate_inertial,
      sample.track,
      sample.heading,
      sample.roll
    ].some(value => value !== null && value !== undefined);
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
        .filter(value => value !== null);
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

function importedTrajectoryLayer(
  label: string,
  trajectories: Trajectory[]
): ImportedLayer[] {
  if (trajectories.length === 0) {
    throw new Error(`No valid trajectories found in ${label}.`);
  }
  const source = createTrajectorySource(trajectories);
  return [{ label, source, bounds: source.bounds }];
}

const geoJsonImporter: FileImporter = {
  id: "geojson",
  label: "GeoJSON",
  canImport: async file => {
    if (
      file.metadata.extension &&
      file.metadata.extension !== ".json" &&
      file.metadata.extension !== ".geojson"
    ) {
      return false;
    }

    if (!JSON_MEDIA_TYPES.has(file.metadata.mediaType)) {
      return false;
    }

    try {
      const json = await file.getJson();
      return looksLikeGeoJson(json);
    } catch {
      return false;
    }
  },
  importFile: async file => {
    const json = await file.getJson();
    const source = createFeatureSourceFromGeoJson(json);
    return [
      {
        label: file.metadata.name,
        source,
        bounds: source.bounds
      }
    ];
  }
};

const topoJsonImporter: FileImporter = {
  id: "topojson",
  label: "TopoJSON",
  canImport: async file => {
    if (
      file.metadata.extension &&
      file.metadata.extension !== ".json" &&
      file.metadata.extension !== ".topojson"
    ) {
      return false;
    }

    if (!JSON_MEDIA_TYPES.has(file.metadata.mediaType)) {
      return false;
    }

    try {
      const json = await file.getJson();
      return looksLikeTopoJson(json);
    } catch {
      return false;
    }
  },
  importFile: async file => {
    const json = await file.getJson();
    if (!looksLikeTopoJson(json)) {
      throw new Error(`${file.metadata.name} does not look like TopoJSON.`);
    }

    const objectEntries = Object.entries(json.objects);
    return objectEntries.map(([objectName, object]) => {
      const geojson = topoJsonFeature(json, object);
      const source = createFeatureSourceFromGeoJson(geojson);
      return {
        label:
          objectEntries.length === 1
            ? file.metadata.name
            : `${file.metadata.name}: ${objectName}`,
        source,
        bounds: source.bounds
      };
    });
  }
};

const flightradar24CsvImporter: FileImporter = {
  id: "fr24-csv",
  label: "Flightradar24 CSV",
  canImport: async file => {
    if (file.metadata.extension !== ".csv") return false;
    const header = (await file.getText()).split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
    return (
      ((header.includes("latitude") && header.includes("longitude")) ||
        header.includes("position")) &&
      header.includes("timestamp")
    );
  },
  importFile: async file => {
    const lines = (await file.getText()).split(/\r?\n/).filter(line => line.trim());
    const header = splitCsvLine(lines[0]);
    const rows = lines
      .slice(1)
      .map(line =>
        Object.fromEntries(
          splitCsvLine(line).map((value, index) => [
            header[index] ?? `field_${index}`,
            value
          ])
        )
      );
    return importedTrajectoryLayer(
      file.metadata.name,
      rowsToTrajectories(rows, {
        idFields: [
          ...csvFieldVariants("Callsign"),
          ...csvFieldVariants("icao24"),
          ...csvFieldVariants("flight_id")
        ],
        latitudeFields: csvFieldVariants("Latitude"),
        longitudeFields: csvFieldVariants("Longitude"),
        timestampFields: [...csvFieldVariants("Timestamp"), ...csvFieldVariants("UTC")],
        altitudeFields: csvFieldVariants("Altitude"),
        selectedAltitudeFields: csvFieldVariants("selected_altitude"),
        speedFields: [
          ...csvFieldVariants("Speed"),
          ...csvFieldVariants("ground_speed")
        ],
        iasFields: csvFieldVariants("ias"),
        tasFields: csvFieldVariants("tas"),
        machFields: csvFieldVariants("mach"),
        verticalRateFields: [
          ...csvFieldVariants("vertical_rate"),
          ...csvFieldVariants("verticalRate")
        ],
        verticalRateBarometricFields: csvFieldVariants("vrate_barometric"),
        verticalRateInertialFields: csvFieldVariants("vrate_inertial"),
        headingFields: [
          ...csvFieldVariants("Direction"),
          ...csvFieldVariants("heading")
        ],
        trackFields: [...csvFieldVariants("track"), ...csvFieldVariants("Direction")],
        rollFields: csvFieldVariants("roll"),
        splitThresholdSeconds: 600,
        defaultProperties: { format: "flightradar24-csv", file: file.metadata.name }
      })
    );
  }
};

const flightradar24JsonImporter: FileImporter = {
  id: "fr24-json",
  label: "Flightradar24 JSON",
  canImport: async file => {
    if (file.metadata.extension !== ".json") return false;
    try {
      const json = await file.getJson();
      return isRecord(json) && Array.isArray(json.track);
    } catch {
      return false;
    }
  },
  importFile: async file => {
    const json = await file.getJson();
    if (!isRecord(json) || !Array.isArray(json.track)) {
      throw new Error(
        `${file.metadata.name} does not look like a Flightradar24 JSON file.`
      );
    }
    const identification = isRecord(json.identification) ? json.identification : {};
    const number = isRecord(identification.number)
      ? identification.number.default
      : undefined;
    const callsign = identification.callsign ?? number ?? file.metadata.name;
    const rows = json.track.filter(isRecord).map(row => ({
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
    return importedTrajectoryLayer(
      file.metadata.name,
      rowsToTrajectories(rows, {
        idFields: ["callsign"],
        latitudeFields: ["latitude"],
        longitudeFields: ["longitude"],
        timestampFields: ["timestamp"],
        altitudeFields: ["altitude"],
        speedFields: ["speed"],
        verticalRateFields: ["vertical_rate"],
        headingFields: ["heading"],
        trackFields: ["track", "heading"],
        splitThresholdSeconds: 600,
        defaultProperties: {
          format: "flightradar24-json",
          file: file.metadata.name,
          callsign
        }
      })
    );
  }
};

async function jsonlSample(file: LazyImportFile): Promise<Record<string, unknown>[]> {
  const text = await file.getText();
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
    } catch {
      return rows;
    }
    if (rows.length >= 20) break;
  }
  return rows;
}

async function parseJsonlRows(
  file: LazyImportFile
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const line of (await file.getText()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (isRecord(parsed)) rows.push(parsed);
  }
  return rows;
}

const RS1090_TRAJECTORY_DF = new Set(["17", "18", "20", "21"]);

function normalizeRs1090Rows(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.flatMap(row => {
    if (!RS1090_TRAJECTORY_DF.has(String(row.df))) return [];

    const bds20 = isRecord(row.bds20) ? row.bds20 : {};
    const bds50 = isRecord(row.bds50) ? row.bds50 : {};
    const bds60 = isRecord(row.bds60) ? row.bds60 : {};
    const callsign = row.callsign ?? bds20.callsign;

    return [
      {
        ...row,
        callsign,
        roll: row.roll ?? bds50.roll,
        track: row.track ?? bds50.track,
        groundspeed: row.groundspeed ?? bds50.groundspeed,
        tas: row.tas ?? row.TAS ?? bds50.TAS ?? bds50.tas,
        heading: row.heading ?? bds60.heading,
        ias: row.ias ?? row.IAS ?? bds60.IAS ?? bds60.ias,
        mach: row.mach ?? row.Mach ?? bds60.Mach ?? bds60.mach,
        vrate_barometric: row.vrate_barometric ?? bds60.vrate_barometric,
        vrate_inertial: row.vrate_inertial ?? bds60.vrate_inertial
      }
    ];
  });
}

const rs1090JsonlImporter: FileImporter = {
  id: "rs1090-jsonl",
  label: "rs1090 JSONL",
  canImport: async file => {
    if (file.metadata.extension !== ".jsonl") return false;
    const sample = await jsonlSample(file);
    return sample.some(
      row => "icao24" in row && ("frame" in row || "bds" in row || "df" in row)
    );
  },
  importFile: async file =>
    importedTrajectoryLayer(
      file.metadata.name,
      rowsToTrajectories(normalizeRs1090Rows(await parseJsonlRows(file)), {
        idFields: ["icao24", "callsign"],
        latitudeFields: ["latitude", "lat"],
        longitudeFields: ["longitude", "lon", "lng"],
        timestampFields: ["timestamp"],
        altitudeFields: ["altitude", "altitude_baro", "altitude_geom"],
        selectedAltitudeFields: ["selected_altitude"],
        speedFields: ["groundspeed", "speed"],
        iasFields: ["ias", "IAS"],
        tasFields: ["tas", "TAS"],
        machFields: ["mach", "Mach"],
        verticalRateFields: ["vertical_rate"],
        verticalRateBarometricFields: ["vrate_barometric"],
        verticalRateInertialFields: ["vrate_inertial"],
        headingFields: ["heading"],
        trackFields: ["track"],
        rollFields: ["roll"],
        splitThresholdSeconds: 600,
        defaultProperties: { format: "rs1090-jsonl", file: file.metadata.name }
      })
    )
};

const aisJsonlImporter: FileImporter = {
  id: "ais-jsonl",
  label: "AIS JSONL",
  canImport: async file => {
    if (file.metadata.extension !== ".jsonl") return false;
    const sample = await jsonlSample(file);
    return sample.some(
      row =>
        "mmsi" in row &&
        ("lat" in row || "latitude" in row) &&
        ("lon" in row || "longitude" in row)
    );
  },
  importFile: async file =>
    importedTrajectoryLayer(
      file.metadata.name,
      rowsToTrajectories(await parseJsonlRows(file), {
        idFields: ["mmsi"],
        latitudeFields: ["lat", "latitude"],
        longitudeFields: ["lon", "longitude"],
        timestampFields: ["timestamp"],
        speedFields: ["speed"],
        headingFields: ["course", "heading"],
        trackFields: ["course", "heading"],
        splitThresholdSeconds: 3600,
        defaultProperties: { format: "ais-jsonl", file: file.metadata.name }
      })
    )
};

const FILE_IMPORTERS = [
  topoJsonImporter,
  geoJsonImporter,
  flightradar24JsonImporter,
  flightradar24CsvImporter,
  rs1090JsonlImporter,
  aisJsonlImporter
] as const;

export async function importDroppedFiles(files: File[]): Promise<ImportedLayer[]> {
  const importedLayers: ImportedLayer[] = [];

  for (const rawFile of files) {
    const file = new LazyImportFile(rawFile);
    let handled = false;

    for (const importer of FILE_IMPORTERS) {
      if (await importer.canImport(file)) {
        const layers = await importer.importFile(file);
        importedLayers.push(...layers);
        handled = true;
        break;
      }
    }

    if (!handled) {
      // TODO better error message when we have a proper toast system
      throw new Error(`No drop importer accepted ${rawFile.name}.`);
    }
  }

  return importedLayers;
}
