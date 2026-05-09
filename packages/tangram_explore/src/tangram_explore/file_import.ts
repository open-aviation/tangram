import {
  createFeatureSourceFromGeoJson,
  type FeatureBounds,
  type FeatureSource
} from "./feature_source";
import type { TableSource } from "./table_source";

const GEOJSON_GEOMETRY_TYPES = new Set<string>([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection"
]);

const GEOJSON_MEDIA_TYPES = new Set(["", "application/json", "application/geo+json"]);

export type ImportedSource = FeatureSource | TableSource;

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

    if (!GEOJSON_MEDIA_TYPES.has(file.metadata.mediaType)) {
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

const FILE_IMPORTERS = [geoJsonImporter] as const;

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
