import type { Table } from "apache-arrow";
import type { FeatureBounds } from "./feature_source";

const LONGITUDE_FIELD_NAMES = ["longitude", "lon", "lng", "long"];
const LATITUDE_FIELD_NAMES = ["latitude", "lat"];
const ALTITUDE_FIELD_NAMES = ["altitude", "alt", "height", "z"];

export interface PointTableCoordinates {
  longitudeField: string;
  latitudeField: string;
  altitudeField: string | null;
}

export interface TableSource {
  kind: "table";
  variant: "table" | "point-table";
  table: Table;
  bounds: FeatureBounds | null;
  stats: {
    rowCount: number;
  };
  coordinates: PointTableCoordinates | null;
  dispose: () => void;
}

function computePointTableBounds(
  table: Table,
  coordinates: PointTableCoordinates | null
): FeatureBounds | null {
  if (!coordinates) return null;

  const longitudeColumn = table.getChild(coordinates.longitudeField);
  const latitudeColumn = table.getChild(coordinates.latitudeField);
  if (!longitudeColumn || !latitudeColumn) return null;

  let bounds: FeatureBounds | null = null;

  for (let index = 0; index < table.numRows; index++) {
    const longitude = Number(longitudeColumn.get(index));
    const latitude = Number(latitudeColumn.get(index));
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

    if (!bounds) {
      bounds = {
        minLon: longitude,
        minLat: latitude,
        maxLon: longitude,
        maxLat: latitude
      };
      continue;
    }

    bounds.minLon = Math.min(bounds.minLon, longitude);
    bounds.minLat = Math.min(bounds.minLat, latitude);
    bounds.maxLon = Math.max(bounds.maxLon, longitude);
    bounds.maxLat = Math.max(bounds.maxLat, latitude);
  }

  return bounds;
}

function findFieldName(table: Table, candidates: readonly string[]): string | null {
  const fields = new Map(
    table.schema.fields.map(field => [field.name.toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const fieldName = fields.get(candidate);
    if (fieldName) {
      return fieldName;
    }
  }

  return null;
}

export function detectPointTableCoordinates(
  table: Table
): PointTableCoordinates | null {
  const longitudeField = findFieldName(table, LONGITUDE_FIELD_NAMES);
  const latitudeField = findFieldName(table, LATITUDE_FIELD_NAMES);

  if (!longitudeField || !latitudeField) {
    return null;
  }

  return {
    longitudeField,
    latitudeField,
    altitudeField: findFieldName(table, ALTITUDE_FIELD_NAMES)
  };
}

export function createTableSource(table: Table, dispose: () => void): TableSource {
  const coordinates = detectPointTableCoordinates(table);
  const bounds = computePointTableBounds(table, coordinates);

  return {
    kind: "table",
    variant: coordinates ? "point-table" : "table",
    table,
    bounds,
    stats: {
      rowCount: table.numRows
    },
    coordinates,
    dispose
  };
}
