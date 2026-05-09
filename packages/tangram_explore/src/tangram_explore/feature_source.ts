import { categoricalColor } from "@open-aviation/tangram-core/utils";

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection"
] as const);

const PREFERRED_COLOR_FIELDS = ["color", "colour", "fill", "fill_color", "fillColor"];

export type GeoJsonGeometryType =
  | "Point"
  | "MultiPoint"
  | "LineString"
  | "MultiLineString"
  | "Polygon"
  | "MultiPolygon"
  | "GeometryCollection";

export type GeoJsonGeometry = Record<string, unknown> & {
  type: GeoJsonGeometryType;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

export type GeoJsonFeature = Record<string, unknown> & {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown> | null;
  id?: string | number;
};

export type GeoJsonFeatureCollection = Record<string, unknown> & {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

export interface FeatureBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface CategoryStat {
  value: string;
  count: number;
}

export interface FeatureSource {
  kind: "features";
  collection: GeoJsonFeatureCollection;
  features: GeoJsonFeature[];
  fields: string[];
  geometryTypes: GeoJsonGeometryType[];
  bounds: FeatureBounds | null;
  styleHints: {
    colorField: string;
    categoryColors: Record<string, string>;
  };
  stats: {
    featureCount: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeometryType(value: unknown): value is GeoJsonGeometryType {
  return typeof value === "string" && GEOMETRY_TYPES.has(value as GeoJsonGeometryType);
}

function normalizeGeometry(value: unknown): GeoJsonGeometry {
  if (!isRecord(value) || !isGeometryType(value.type)) {
    throw new Error("invalid GeoJSON geometry");
  }

  if (value.type !== "GeometryCollection") {
    return value as GeoJsonGeometry;
  }

  const geometries = Array.isArray(value.geometries)
    ? value.geometries.map(normalizeGeometry)
    : [];

  return {
    ...value,
    type: "GeometryCollection",
    geometries
  };
}

function normalizeFeature(value: unknown): GeoJsonFeature {
  if (!isRecord(value) || value.type !== "Feature") {
    throw new Error("invalid GeoJSON feature");
  }

  return {
    ...value,
    type: "Feature",
    geometry:
      value.geometry === null || value.geometry === undefined
        ? null
        : normalizeGeometry(value.geometry),
    properties: isRecord(value.properties) ? value.properties : null
  };
}

function featureFromGeometry(geometry: GeoJsonGeometry): GeoJsonFeature {
  return {
    type: "Feature",
    geometry,
    properties: null
  };
}

function normalizeCollection(value: unknown): GeoJsonFeatureCollection {
  if (!isRecord(value)) {
    throw new Error("GeoJSON must be an object");
  }

  if (value.type === "FeatureCollection") {
    if (!Array.isArray(value.features)) {
      throw new Error("GeoJSON FeatureCollection must have a features array");
    }

    return {
      ...value,
      type: "FeatureCollection",
      features: value.features.map(normalizeFeature)
    };
  }

  if (value.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [normalizeFeature(value)]
    };
  }

  if (isGeometryType(value.type)) {
    return {
      type: "FeatureCollection",
      features: [featureFromGeometry(normalizeGeometry(value))]
    };
  }

  throw new Error("GeoJSON must be a FeatureCollection, Feature, or Geometry object");
}

function extendBoundsFromCoordinates(coordinates: unknown, bounds: FeatureBounds) {
  if (!Array.isArray(coordinates)) {
    return;
  }

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    const [lon, lat] = coordinates;
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    return;
  }

  for (const child of coordinates) {
    extendBoundsFromCoordinates(child, bounds);
  }
}

function extendBoundsFromGeometry(
  geometry: GeoJsonGeometry | null,
  bounds: FeatureBounds
) {
  if (!geometry) {
    return;
  }

  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries ?? []) {
      extendBoundsFromGeometry(child, bounds);
    }
    return;
  }

  extendBoundsFromCoordinates(geometry.coordinates, bounds);
}

function detectColorField(fields: string[]): string {
  for (const preferred of PREFERRED_COLOR_FIELDS) {
    const field = fields.find(value => value.toLowerCase() === preferred.toLowerCase());
    if (field) {
      return field;
    }
  }

  return "";
}

function categoryColorsFromFeatures(
  features: GeoJsonFeature[],
  field: string
): Record<string, string> {
  if (!field) {
    return {};
  }

  const colors: Record<string, string> = {};

  for (const feature of features) {
    const value = feature.properties?.[field];
    if (typeof value === "string") {
      colors[value] = value;
    }
  }

  return colors;
}

export function featureCategoryValue(feature: GeoJsonFeature, field: string): string {
  if (!field) {
    return "";
  }

  const value = feature.properties?.[field];
  return value === undefined || value === null ? "(empty)" : String(value);
}

export function categoryStatsForField(
  source: FeatureSource,
  field: string
): CategoryStat[] {
  if (!field) {
    return [];
  }

  const counts = new Map<string, number>();

  for (const feature of source.features) {
    const category = featureCategoryValue(feature, field);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

export function categoryColorsForField(
  source: FeatureSource,
  field: string,
  colorField: string,
  existingColors: Record<string, string> = {}
): Record<string, string> {
  if (!field) {
    return {};
  }

  const colors: Record<string, string> = { ...existingColors };

  for (const feature of source.features) {
    const category = featureCategoryValue(feature, field);
    const colorValue = colorField ? feature.properties?.[colorField] : undefined;
    if (typeof colorValue === "string") {
      colors[category] ??= colorValue;
    }
  }

  for (const stat of categoryStatsForField(source, field)) {
    colors[stat.value] ??= categoricalColor(stat.value);
  }

  return colors;
}

export function filteredFeatureCollection(
  source: FeatureSource,
  field: string,
  hiddenCategories: Record<string, boolean>
): GeoJsonFeatureCollection {
  if (!field || Object.keys(hiddenCategories).length === 0) {
    return source.collection;
  }

  return {
    ...source.collection,
    features: source.features.filter(
      feature => !hiddenCategories[featureCategoryValue(feature, field)]
    )
  };
}

export function createFeatureSourceFromGeoJson(value: unknown): FeatureSource {
  const collection = normalizeCollection(value);

  const fieldsSet = new Set<string>();
  const geometryTypesSet = new Set<GeoJsonGeometryType>();
  const bounds: FeatureBounds = {
    minLon: Number.POSITIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY
  };

  const visit = (geometry: GeoJsonGeometry | null) => {
    if (!geometry) {
      return;
    }

    geometryTypesSet.add(geometry.type);
    if (geometry.type === "GeometryCollection") {
      for (const child of geometry.geometries ?? []) {
        visit(child);
      }
    }
  };

  for (const feature of collection.features) {
    if (feature.properties) {
      for (const key of Object.keys(feature.properties)) {
        fieldsSet.add(key);
      }
    }

    visit(feature.geometry);
    extendBoundsFromGeometry(feature.geometry, bounds);
  }

  const fields = [...fieldsSet].sort();
  const colorField = detectColorField(fields);

  const validBounds = [
    bounds.minLon,
    bounds.minLat,
    bounds.maxLon,
    bounds.maxLat
  ].every(Number.isFinite)
    ? bounds
    : null;

  return {
    kind: "features",
    collection,
    features: collection.features,
    fields,
    geometryTypes: [...geometryTypesSet].sort(),
    bounds: validBounds,
    styleHints: {
      colorField,
      categoryColors: categoryColorsFromFeatures(collection.features, colorField)
    },
    stats: {
      featureCount: collection.features.length
    }
  };
}
