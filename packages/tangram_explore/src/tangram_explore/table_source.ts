import type { Table } from "apache-arrow";

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
  stats: {
    rowCount: number;
  };
  coordinates: PointTableCoordinates | null;
  dispose: () => void;
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

  return {
    kind: "table",
    variant: coordinates ? "point-table" : "table",
    table,
    stats: {
      rowCount: table.numRows
    },
    coordinates,
    dispose
  };
}
