import { reactive, shallowRef, triggerRef } from "vue";
import type { Table } from "apache-arrow";
import type { Table as WasmTable } from "parquet-wasm";

export type ColorSpec =
  | string
  | [number, number, number]
  | [number, number, number, number];

export interface ScatterOptions {
  kind: "scatter";
  radius_scale: number;
  radius_min_pixels: number;
  radius_max_pixels: number;
  line_width_min_pixels: number;
  fill_color: ColorSpec;
  line_color: ColorSpec;
  opacity: number;
  stroked: boolean;
  filled: boolean;
  pickable: boolean;
}

export type GeoJsonStyleMode = "single" | "category";

export interface GeoJsonOptions {
  kind: "geojson";
  fill_color: ColorSpec;
  line_color: ColorSpec;
  point_radius: number;
  line_width: number;
  opacity: number;
  stroked: boolean;
  filled: boolean;
  extruded: boolean;
  pickable: boolean;
  style_mode: GeoJsonStyleMode;
  color_field: string;
  category_field: string;
  category_colors: Record<string, string>;
  hidden_categories: Record<string, boolean>;
}

export type StyleOptions = ScatterOptions | GeoJsonOptions;
export type GeoJsonData = Record<string, unknown>;

export interface ParquetLayerEntry {
  id: string;
  label: string;
  source: "parquet";
  table: Table;
  wasmRef: WasmTable;
  style: ScatterOptions;
  visible: boolean;
}

export interface GeoJsonLayerEntry {
  id: string;
  label: string;
  source: "geojson";
  data: GeoJsonData;
  style: GeoJsonOptions;
  visible: boolean;
}

export type LayerEntry = ParquetLayerEntry | GeoJsonLayerEntry;

export const layers = shallowRef<LayerEntry[]>([]);

export const pluginConfig = reactive({
  enable_3d: false
});

export function addLayer(
  id: string,
  label: string,
  table: Table,
  wasmRef: WasmTable,
  style: ScatterOptions
) {
  if (layers.value.some(d => d.id === id)) return;
  layers.value.push({ id, label, source: "parquet", table, wasmRef, style, visible: true });
  triggerRef(layers);
}

function geoJsonFeatures(data: GeoJsonData): Record<string, unknown>[] {
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data.features.filter(
      feature => typeof feature === "object" && feature !== null
    ) as Record<string, unknown>[];
  }
  if (data.type === "Feature") return [data];
  return [];
}

function detectColorPropertyField(data: GeoJsonData): string {
  const preferredNames = ["color", "colour", "fill", "fill_color", "fillColor"];
  const fields = new Set<string>();
  for (const feature of geoJsonFeatures(data)) {
    const properties = feature.properties;
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      continue;
    }
    for (const key of Object.keys(properties)) fields.add(key);
  }

  for (const preferred of preferredNames) {
    const match = [...fields].find(field => field.toLowerCase() === preferred.toLowerCase());
    if (match) return match;
  }
  return "";
}

function categoryColorsFromProperty(data: GeoJsonData, field: string): Record<string, string> {
  if (!field) return {};
  const colors: Record<string, string> = {};
  for (const feature of geoJsonFeatures(data)) {
    const properties = feature.properties;
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      continue;
    }
    const value = properties[field as keyof typeof properties];
    if (typeof value === "string") colors[value] = value;
  }
  return colors;
}

export function addGeoJsonLayer(label: string, data: GeoJsonData) {
  const id = crypto.randomUUID();
  const propertyColorField = detectColorPropertyField(data);
  layers.value.push({
    id,
    label,
    source: "geojson",
    data,
    visible: true,
    style: {
      kind: "geojson",
      fill_color: "oklch(39.53% 0.15 259.87)",
      line_color: "oklch(39.53% 0.15 259.87)",
      point_radius: 4,
      line_width: 2,
      opacity: 0.75,
      stroked: true,
      filled: true,
      extruded: false,
      pickable: true,
      style_mode: propertyColorField ? "category" : "single",
      color_field: propertyColorField,
      category_field: propertyColorField,
      category_colors: categoryColorsFromProperty(data, propertyColorField),
      hidden_categories: {}
    }
  });
  triggerRef(layers);
}

export function removeLayer(id: string) {
  const idx = layers.value.findIndex(d => d.id === id);
  if (idx !== -1) {
    const entry = layers.value[idx];
    if (entry.source === "parquet") entry.wasmRef.free();
    layers.value.splice(idx, 1);
    triggerRef(layers);
  }
}

export function clearLayers() {
  layers.value.forEach(e => {
    if (e.source === "parquet") e.wasmRef.free();
  });
  layers.value = [];
  triggerRef(layers);
}

export function toggleLayerVisibility(id: string) {
  const layer = layers.value.find(d => d.id === id);
  if (layer) {
    layer.visible = !layer.visible;
    triggerRef(layers);
  }
}

export function updateGeoJsonStyle(id: string, patch: Partial<GeoJsonOptions>) {
  const layer = layers.value.find(d => d.id === id);
  if (layer?.source !== "geojson") return;
  layer.style = { ...layer.style, ...patch };
  triggerRef(layers);
}

export function setGeoJsonCategoryColor(id: string, category: string, color: string) {
  const layer = layers.value.find(d => d.id === id);
  if (layer?.source !== "geojson") return;
  layer.style.category_colors = {
    ...layer.style.category_colors,
    [category]: color
  };
  triggerRef(layers);
}

export function toggleGeoJsonCategory(id: string, category: string) {
  const layer = layers.value.find(d => d.id === id);
  if (layer?.source !== "geojson") return;
  layer.style.hidden_categories = {
    ...layer.style.hidden_categories,
    [category]: !layer.style.hidden_categories[category]
  };
  triggerRef(layers);
}

export function colorToHex(c: ColorSpec, fallback = "#273f77"): string {
  const [r, g, b] = parseColor(c, [39, 63, 119, 255]);
  if ([r, g, b].some(v => Number.isNaN(v))) return fallback;
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function linearToSrgb(value: number): number {
  const srgb =
    value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
}

function parseOklch(c: string): [number, number, number, number] | null {
  const match = c.match(
    /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/i
  );
  if (!match) return null;

  const l = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const alpha = match[4]?.endsWith("%")
    ? (Number(match[4].slice(0, -1)) / 100) * 255
    : Number(match[4] ?? 1) * 255;

  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCube = lPrime ** 3;
  const mCube = mPrime ** 3;
  const sCube = sPrime ** 3;

  return [
    linearToSrgb(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube),
    linearToSrgb(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube),
    linearToSrgb(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube),
    Math.round(Math.min(255, Math.max(0, alpha)))
  ];
}

export function parseColor(
  c: ColorSpec,
  defaultColor: [number, number, number, number]
): [number, number, number, number] {
  if (Array.isArray(c)) {
    return c.length === 3
      ? ([...c, 255] as [number, number, number, number])
      : (c as [number, number, number, number]);
  }
  if (typeof c === "string" && c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b, 255];
    }
  }
  if (typeof c === "string" && c.toLowerCase().startsWith("oklch(")) {
    return parseOklch(c) ?? defaultColor;
  }
  return defaultColor;
}
