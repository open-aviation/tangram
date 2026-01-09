import type { TangramApi } from "@open-aviation/tangram-core/api";
import initWasm, { readParquet, wasmMemory } from "parquet-wasm";
import { parseTable } from "arrow-js-ffi";
import ExploreLayers from "./ExploreLayers.vue";
import LayerList from "./LayerList.vue";
import {
  addLayer,
  clearLayers,
  removeLayer,
  type StyleOptions,
  pluginConfig
} from "./store";

const EXPLORE_CHANNEL = "explore";
const EXPLORE_EVENT = "layers";

let wasmInitialized = false;

async function initParquetWasm() {
  if (wasmInitialized) return;
  await initWasm("/parquet_wasm_bg.wasm");
  wasmInitialized = true;
}

interface LayerDefinition {
  id: string;
  label: string;
  url: string;
  style: StyleOptions;
}

interface StackMessage {
  op: "add" | "remove" | "clear";
  layer?: LayerDefinition;
  id?: string;
}

async function loadAndAdd(def: LayerDefinition) {
  const resp = await fetch(def.url);
  const arrayBuffer = await resp.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const wasmTable = readParquet(data);
  const ffiTable = wasmTable.intoFFI();
  const memory = wasmMemory().buffer;

  const arrowTable = parseTable(
    memory,
    ffiTable.arrayAddrs(),
    ffiTable.schemaAddr(),
    true // copying is required because adding new layers can grow wasm memory and detach
  );
  addLayer(def.id, def.label, arrowTable, wasmTable, def.style);
}

async function handleMessage(payload: StackMessage) {
  if (payload.op === "add" && payload.layer) {
    await loadAndAdd(payload.layer);
  } else if (payload.op === "clear") {
    clearLayers();
  } else if (payload.op === "remove" && payload.id) {
    removeLayer(payload.id);
  }
}

async function syncLayers() {
  const res = await fetch("/explore/layers");
  const layerDefs: LayerDefinition[] = await res.json();
  clearLayers();
  for (const def of layerDefs) {
    await loadAndAdd(def);
  }
}

export async function install(
  api: TangramApi,
  config?: { enable_3d?: boolean | "inherit" }
) {
  if (config) {
    if (config.enable_3d !== undefined) pluginConfig.enable_3d = config.enable_3d;
  }

  api.ui.registerWidget("explore-layers-map", "MapOverlay", ExploreLayers);
  api.ui.registerWidget("explore-layers-list", "SideBar", LayerList, {
    title: "Explore Layers"
  });

  await initParquetWasm();
  await api.realtime.ensureConnected();

  api.realtime.subscribe<StackMessage>(
    `${EXPLORE_CHANNEL}:${EXPLORE_EVENT}`,
    handleMessage
  );
  await syncLayers();
}
