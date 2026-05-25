import { feature as topoJsonFeature } from "topojson-client";
import type { Objects, Topology } from "topojson-specification";
import {
  LazyImportFile,
  type Disposable,
  type TangramApi,
  type WorkspaceImporter
} from "@open-aviation/tangram-core/api";
import {
  isRecord,
  parseCsvRows,
  parseJsonlRows
} from "@open-aviation/tangram-core/utils";
import {
  createFeatureDatasetInput,
  createTrajectoryDatasetInput,
  type ExploreDatasetInput
} from "./datasets";
import { createFeatureSourceFromGeoJson } from "./feature_source";
import {
  detectTrajectoryOptions,
  extractTrajectoryJsonRows,
  jsonlSample,
  rowsToTrajectories
} from "./trajectory_import";
import { createTrajectorySource } from "./trajectory_source";

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

function importedTrajectoryDataset(
  label: string,
  datasets: ReturnType<typeof rowsToTrajectories>
): ExploreDatasetInput[] {
  if (datasets.length === 0) {
    throw new Error(`No valid trajectories found in ${label}.`);
  }

  return [createTrajectoryDatasetInput(label, createTrajectorySource(datasets))];
}

function createExploreImporters(pluginId: string): WorkspaceImporter[] {
  const geoJsonImporter: WorkspaceImporter = {
    id: "geojson",
    pluginId,
    priority: 100,
    accepts: async file => {
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
        return looksLikeGeoJson(await file.getJson());
      } catch {
        return false;
      }
    },
    parse: async file => {
      const source = createFeatureSourceFromGeoJson(await file.getJson());
      return [createFeatureDatasetInput(file.metadata.name, source)];
    }
  };

  const topoJsonImporter: WorkspaceImporter = {
    id: "topojson",
    pluginId,
    priority: 110,
    accepts: async file => {
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
        return looksLikeTopoJson(await file.getJson());
      } catch {
        return false;
      }
    },
    parse: async file => {
      const json = await file.getJson();
      if (!looksLikeTopoJson(json)) {
        throw new Error(`${file.metadata.name} does not look like TopoJSON.`);
      }

      const objectEntries = Object.entries(json.objects);
      return objectEntries.map(([objectName, object]) =>
        createFeatureDatasetInput(
          objectEntries.length === 1
            ? file.metadata.name
            : `${file.metadata.name}: ${objectName}`,
          createFeatureSourceFromGeoJson(topoJsonFeature(json, object))
        )
      );
    }
  };

  const trajectoryCsvImporter: WorkspaceImporter = {
    id: "trajectory-csv",
    pluginId,
    priority: 10,
    accepts: async file => {
      if (file.metadata.extension !== ".csv") return false;
      const rows = parseCsvRows(await file.getText(), 20);
      return (
        detectTrajectoryOptions(rows, {
          format: "trajectory-csv",
          file: file.metadata.name
        }) !== null
      );
    },
    parse: async file => {
      const rows = parseCsvRows(await file.getText());
      const options = detectTrajectoryOptions(rows, {
        format: "trajectory-csv",
        file: file.metadata.name
      });
      if (!options) {
        throw new Error(
          `${file.metadata.name} does not look like a trajectory CSV file.`
        );
      }

      return importedTrajectoryDataset(
        file.metadata.name,
        rowsToTrajectories(rows, options)
      );
    }
  };

  const trajectoryJsonImporter: WorkspaceImporter = {
    id: "trajectory-json",
    pluginId,
    priority: 20,
    accepts: async file => {
      if (file.metadata.extension !== ".json") return false;
      try {
        const rows = extractTrajectoryJsonRows(
          await file.getJson(),
          file.metadata.name
        );
        return (
          rows !== null &&
          detectTrajectoryOptions(rows, {
            format: "trajectory-json",
            file: file.metadata.name
          }) !== null
        );
      } catch {
        return false;
      }
    },
    parse: async file => {
      const rows = extractTrajectoryJsonRows(await file.getJson(), file.metadata.name);
      if (!rows) {
        throw new Error(
          `${file.metadata.name} does not look like a trajectory JSON file.`
        );
      }

      const options = detectTrajectoryOptions(rows, {
        format: "trajectory-json",
        file: file.metadata.name
      });
      if (!options) {
        throw new Error(
          `${file.metadata.name} does not look like a trajectory JSON file.`
        );
      }

      return importedTrajectoryDataset(
        file.metadata.name,
        rowsToTrajectories(rows, options)
      );
    }
  };

  const trajectoryJsonlImporter: WorkspaceImporter = {
    id: "trajectory-jsonl",
    pluginId,
    priority: 5,
    accepts: async file => {
      if (file.metadata.extension !== ".jsonl") return false;
      const rows = await jsonlSample(file);
      return (
        detectTrajectoryOptions(rows, {
          format: "trajectory-jsonl",
          file: file.metadata.name
        }) !== null
      );
    },
    parse: async file => {
      const rows = await parseJsonlRows(file);
      const options = detectTrajectoryOptions(rows, {
        format: "trajectory-jsonl",
        file: file.metadata.name
      });
      if (!options) {
        throw new Error(
          `${file.metadata.name} does not look like a trajectory JSONL file.`
        );
      }

      return importedTrajectoryDataset(
        file.metadata.name,
        rowsToTrajectories(rows, options)
      );
    }
  };

  return [
    topoJsonImporter,
    geoJsonImporter,
    trajectoryJsonImporter,
    trajectoryJsonlImporter,
    trajectoryCsvImporter
  ];
}

export function registerExploreImporters(
  api: TangramApi,
  pluginId: string
): Disposable[] {
  return createExploreImporters(pluginId).map(importer =>
    api.import.registerImporter(importer)
  );
}

export { LazyImportFile };
