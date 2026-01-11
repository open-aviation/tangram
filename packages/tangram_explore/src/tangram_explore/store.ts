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

export type StyleOptions = ScatterOptions;

export interface LayerEntry {
  id: string;
  label: string;
  table: Table;
  wasmRef: WasmTable;
  style: StyleOptions;
  visible: boolean;
}

export const layers = shallowRef<LayerEntry[]>([]);

export const pluginConfig = reactive({
  enable_3d: "inherit" as boolean | "inherit"
});

export function addLayer(
  id: string,
  label: string,
  table: Table,
  wasmRef: WasmTable,
  style: StyleOptions
) {
  if (layers.value.some(d => d.id === id)) return;
  layers.value.push({ id, label, table, wasmRef, style, visible: true });
  triggerRef(layers);
}

export function removeLayer(id: string) {
  const idx = layers.value.findIndex(d => d.id === id);
  if (idx !== -1) {
    const entry = layers.value[idx];
    entry.wasmRef.free();
    layers.value.splice(idx, 1);
    triggerRef(layers);
  }
}

export function clearLayers() {
  layers.value.forEach(e => e.wasmRef.free());
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
  return defaultColor;
}
