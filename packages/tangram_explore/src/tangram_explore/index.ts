import { watch } from "vue";
import {
  type PluginContext,
  type SearchResult,
  type TangramApi
} from "@open-aviation/tangram-core/api";
import initWasm, { readParquet, wasmMemory } from "parquet-wasm";
import { parseTable } from "arrow-js-ffi";
import ExploreLayers from "./ExploreLayers.vue";
import ExploreTrajectoryResult from "./ExploreTrajectoryResult.vue";
import ExploreTrajectoryWidget from "./ExploreTrajectoryWidget.vue";
import FileDropTarget from "./FileDropTarget.vue";
import LayerList from "./LayerList.vue";
import {
  addServerTableLayer,
  clearLayers,
  removeLayer,
  layers,
  type ScatterOptions,
  pluginConfig
} from "./store";
import {
  exploreTrajectoryKey,
  exploreTrajectoryRecords,
  hasSelectedTrajectory,
  selectedTrajectory,
  selectedTrajectoryKey,
  type ExploreTrajectorySelectionPayload
} from "./trajectory_selection";

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
  style: ScatterOptions;
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
  addServerTableLayer(def.id, def.label, arrowTable, wasmTable, def.style);
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

function searchTextMatches(
  query: string,
  state: ExploreTrajectorySelectionPayload
): boolean {
  const searchableValues = [
    state.trajectoryId,
    state.layerLabel,
    ...Object.values(state.properties).map(value => String(value ?? ""))
  ];

  return searchableValues.some(value => value.toLowerCase().includes(query));
}

function searchScore(query: string, state: ExploreTrajectorySelectionPayload): number {
  const trajectoryId = state.trajectoryId.toLowerCase();
  const layerLabel = state.layerLabel.toLowerCase();

  if (trajectoryId === query) return 140;
  if (trajectoryId.startsWith(query)) return 120;
  if (layerLabel.startsWith(query)) return 100;
  return 80;
}

function focusTrajectory(
  api: TangramApi,
  state: ExploreTrajectorySelectionPayload
): void {
  const key = exploreTrajectoryKey(state.entryId, state.trajectoryId);
  selectedTrajectoryKey.value = exploreTrajectoryRecords.value.has(key) ? key : null;

  const bounds = state.bounds;
  if (!bounds) return;

  const [minLon, minLat, maxLon, maxLat] = bounds;
  if (minLon === maxLon && minLat === maxLat) {
    api.map.getMapInstance().flyTo({ center: [minLon, minLat], zoom: 9 });
    return;
  }

  api.map.getMapInstance().fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat]
    ],
    { padding: 40 }
  );
}

function buildTrajectorySearchResults(api: TangramApi, query: string): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];

  const results: SearchResult[] = [];

  for (const [keyId, state] of exploreTrajectoryRecords.value) {
    if (!searchTextMatches(normalizedQuery, state)) continue;

    results.push({
      id: `explore-trajectory-${keyId}`,
      component: ExploreTrajectoryResult,
      props: {
        trajectoryId: state.trajectoryId,
        layerLabel: state.layerLabel,
        points: state.pointCount
      },
      score: searchScore(normalizedQuery, state),
      onSelect: () => focusTrajectory(api, state)
    });
  }

  return results
    .sort((left, right) => {
      const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return left.id.localeCompare(right.id);
    })
    .slice(0, 25);
}

export async function install(ctx: PluginContext, config?: { enable_3d?: boolean }) {
  const api = ctx.api;

  if (config) {
    if (config.enable_3d !== undefined) pluginConfig.enable_3d = config.enable_3d;
  }

  api.ui.registerWidget("explore-layers-map", "MapOverlay", ExploreLayers, {
    pluginId: ctx.id
  });
  api.ui.registerWidget("explore-file-drop", "MapOverlay", FileDropTarget, {
    pluginId: ctx.id
  });
  api.ui.registerWidget("explore-layers-list", "SideBar", LayerList, {
    pluginId: ctx.id,
    title: "Explore Layers",
    visible: () => layers.value.length > 0
  });
  api.ui.registerWidget(
    "explore-trajectory-widget",
    "SideBar",
    ExploreTrajectoryWidget,
    {
      pluginId: ctx.id,
      title: "Explore Trajectory",
      visible: () => hasSelectedTrajectory.value
    }
  );

  api.search.registerProvider({
    id: "explore-trajectories",
    pluginId: ctx.id,
    name: "Explore Trajectories",
    search: async (query: string) => buildTrajectorySearchResults(api, query)
  });

  await initParquetWasm();
  await api.realtime.ensureConnected();

  ctx.onDispose(
    await api.realtime.subscribe<StackMessage>(
      `${EXPLORE_CHANNEL}:${EXPLORE_EVENT}`,
      handleMessage
    )
  );

  ctx.onDispose({
    dispose: watch(selectedTrajectory, trajectory => {
      if (!trajectory) return;
      const widget = api.ui.widgets.SideBar.find(
        entry => entry.id === "explore-trajectory-widget"
      );
      if (widget) {
        widget.isCollapsed = false;
      }
    })
  });

  await syncLayers();
}
