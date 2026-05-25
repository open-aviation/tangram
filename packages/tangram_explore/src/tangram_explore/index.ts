import { watch } from "vue";
import {
  type PluginContext,
  type SearchResult,
  type TangramApi
} from "@open-aviation/tangram-core/api";
import initWasm, { readParquet, wasmMemory } from "parquet-wasm";
import { parseTable } from "arrow-js-ffi";
import ExploreDatasetChip from "./ExploreDatasetChip.vue";
import ExploreFeatureDetails from "./ExploreFeatureDetails.vue";
import ExploreLayers from "./ExploreLayers.vue";
import ExploreTrajectoryResult from "./ExploreTrajectoryResult.vue";
import ExploreTrajectoryDetails from "./ExploreTrajectoryDetails.vue";
import ExploreTrajectoryWidget from "./ExploreTrajectoryWidget.vue";
import { pluginConfig } from "./config";
import { createTableDatasetInput, type ScatterOptions } from "./datasets";
import { registerExploreImporters } from "./file_import";
import { createTableSource } from "./table_source";
import {
  rebuildExploreTrajectoryRecords,
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
const serverLayerIds = new Set<string>();

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
  serverLayerIds.add(def.id);
  return createTableDatasetInput(
    def.label,
    createTableSource(arrowTable, () => wasmTable.free()),
    {
      id: def.id,
      style: def.style
    }
  );
}

function removeServerLayer(api: TangramApi, id: string) {
  if (!serverLayerIds.has(id)) return;
  api.workspace.remove(id);
  serverLayerIds.delete(id);
}

function clearServerLayers(api: TangramApi) {
  for (const id of [...serverLayerIds]) {
    api.workspace.remove(id);
  }
  serverLayerIds.clear();
}

async function handleMessage(api: TangramApi, pluginId: string, payload: StackMessage) {
  if (payload.op === "add" && payload.layer) {
    const dataset = await loadAndAdd(payload.layer);
    api.workspace.add({ ...dataset, pluginId });
  } else if (payload.op === "clear") {
    clearServerLayers(api);
  } else if (payload.op === "remove" && payload.id) {
    removeServerLayer(api, payload.id);
  }
}

async function syncLayers(api: TangramApi, pluginId: string) {
  const res = await fetch("/explore/layers");
  const layerDefs: LayerDefinition[] = await res.json();
  clearServerLayers(api);
  for (const def of layerDefs) {
    const dataset = await loadAndAdd(def);
    api.workspace.add({ ...dataset, pluginId });
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

  ctx.onDispose(
    api.ui.registerWorkspaceComponents("features", {
      pluginId: ctx.id,
      chip: ExploreDatasetChip,
      details: ExploreFeatureDetails
    })
  );
  ctx.onDispose(
    api.ui.registerWorkspaceComponents("table", {
      pluginId: ctx.id,
      chip: ExploreDatasetChip
    })
  );
  ctx.onDispose(
    api.ui.registerWorkspaceComponents("trajectories", {
      pluginId: ctx.id,
      chip: ExploreDatasetChip,
      details: ExploreTrajectoryDetails
    })
  );

  if (config) {
    if (config.enable_3d !== undefined) pluginConfig.enable_3d = config.enable_3d;
  }

  api.ui.registerWidget("explore-layers-map", "MapOverlay", ExploreLayers, {
    pluginId: ctx.id
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

  for (const disposable of registerExploreImporters(api, ctx.id)) {
    ctx.onDispose(disposable);
  }

  ctx.onDispose(
    await api.realtime.subscribe<StackMessage>(
      `${EXPLORE_CHANNEL}:${EXPLORE_EVENT}`,
      payload => handleMessage(api, ctx.id, payload)
    )
  );

  ctx.onDispose({
    dispose: watch(
      api.workspace.datasets,
      datasets => rebuildExploreTrajectoryRecords(datasets),
      { immediate: true }
    )
  });

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

  await syncLayers(api, ctx.id);
}
