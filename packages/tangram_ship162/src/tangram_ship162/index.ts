import { watch } from "vue";
import {
  type Disposable,
  type Entity,
  type PluginContext,
  type SearchResult,
  type TangramApi
} from "@open-aviation/tangram-core/api";
import {
  TrajectoryApi,
  type BusResultEnvelope,
  type TrajectoryGetRequest,
  type TrajectoryGetResult,
  type SelectionMap
} from "@open-aviation/tangram-core/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";
import ShipResult from "./ShipResult.vue";
import ShipHistoryLayer from "./ShipHistoryLayer.vue";
import ShipHistoryGroup from "./ShipHistoryGroup.vue";
import ShipHistoryInterval from "./ShipHistoryInterval.vue";
import Ship162DatasetChip from "./Ship162DatasetChip.vue";
import {
  pluginConfig,
  shipStore,
  type HistoryInterval,
  type ShipSelectionData,
  type TrailColorOptions
} from "./store";
import {
  SHIP162_IMPORTED_HISTORY_KIND,
  acceptsShip162Jsonl,
  parseShip162Jsonl
} from "./imported_trajectory";

const ENTITY_TYPE = "ship162_ship";

// deduplicate trajectory backfill fetches across multiple consumers.
const trajectoryFetches = new Map<string, Promise<unknown[]>>();

interface Ship162FrontendConfig {
  topbar_order: number;
  sidebar_order: number;
  search_channel: string;
  trail_color: string | TrailColorOptions;
  trail_alpha: number;
}

export interface MmsiInfo {
  country: string;
  flag: string;
  "iso-3166-1": string;
}

export interface Ship162Vessel {
  mmsi: string;
  timestamp?: number;
  lastseen?: number;
  latitude?: number;
  longitude?: number;
  ship_name?: string;
  course?: number;
  speed?: number;
  destination?: string;
  mmsi_info?: MmsiInfo;
  ship_type?: string;
  status?: string;
  callsign?: string;
  heading?: number;
  imo?: number;
  draught?: number;
  to_bow?: number;
  to_stern?: number;
  to_port?: number;
  to_starboard?: number;
  turn?: number;
}

interface BackendSearchResult {
  state: Ship162Vessel;
  score: number;
}

export function install(ctx: PluginContext, config?: Ship162FrontendConfig) {
  const api = ctx.api;
  const channel = config?.search_channel || "ship162:search";

  if (config) {
    ctx.onDispose({
      dispose: watch(
        () => config.trail_color,
        value => (pluginConfig.trailColor = value),
        { immediate: true, deep: true }
      )
    });
    ctx.onDispose({
      dispose: watch(
        () => config.trail_alpha,
        value => (pluginConfig.trailAlpha = value),
        { immediate: true }
      )
    });
  }

  ctx.onDispose(
    api.ui.registerWorkspaceComponents(SHIP162_IMPORTED_HISTORY_KIND, {
      pluginId: ctx.id,
      chip: Ship162DatasetChip
    })
  );

  ctx.onDispose(
    api.import.registerImporter({
      id: "ship162-jsonl",
      pluginId: ctx.id,
      priority: 200,
      accepts: acceptsShip162Jsonl,
      parse: parseShip162Jsonl
    })
  );

  api.ui.registerWidget("ship162-count-widget", "TopBar", ShipCountWidget, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });
  api.ui.registerWidget("ship162-info-widget", "SideBar", ShipInfoWidget, {
    pluginId: ctx.id,
    priority: config?.sidebar_order,
    title: "Ship Details",
    relevantFor: ENTITY_TYPE
  });
  api.ui.registerWidget("ship162-ship-layer", "MapOverlay", ShipLayer, {
    pluginId: ctx.id
  });
  api.ui.registerWidget("ship162-trail-layer", "MapOverlay", ShipTrailLayer, {
    pluginId: ctx.id
  });
  api.ui.registerWidget("ship162-history-layer", "MapOverlay", ShipHistoryLayer, {
    pluginId: ctx.id
  });

  api.state.registerEntityType(ENTITY_TYPE, { pluginId: ctx.id });

  api.search.registerProvider({
    id: "ships",
    pluginId: ctx.id,
    name: "Ships (Live)",
    search: async (query, signal) => {
      void signal;
      if (query.length < 3) return [];
      try {
        const results = await api.realtime.request<BackendSearchResult[]>(
          channel,
          { query },
          5000
        );
        return results.map(r => ({
          id: `ship-${r.state.mmsi}`,
          component: ShipResult,
          props: {
            name: r.state.ship_name,
            mmsi: r.state.mmsi.toString(),
            callsign: r.state.callsign,
            type: r.state.ship_type
          },
          score: r.score,
          onSelect: () => {
            const entity: Entity = {
              id: r.state.mmsi.toString(),
              type: ENTITY_TYPE,
              state: r.state
            };
            api.selection.selectEntity(entity, true);

            if (r.state.latitude != null && r.state.longitude != null) {
              api.map.getMapInstance().flyTo({
                center: [r.state.longitude, r.state.latitude],
                zoom: 10
              });
            }
          }
        }));
      } catch {
        return [];
      }
    }
  });

  api.search.registerProvider({
    id: "ships-history",
    pluginId: ctx.id,
    name: "Ships (History)",
    search: async (query, signal) => {
      if (query.length < 3) return [];
      try {
        const res = await fetch(`/ship162/search?q=${encodeURIComponent(query)}`, {
          signal
        });
        if (!res.ok) return [];
        const intervals: HistoryInterval[] = await res.json();

        const groups = new Map<string, HistoryInterval[]>();
        for (const iv of intervals) {
          const key = `${iv.mmsi}|${iv.ship_name || "Unknown"}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(iv);
        }

        const results: SearchResult[] = [];
        for (const [key, groupIntervals] of groups) {
          const [mmsi, name] = key.split("|");

          results.push({
            id: `group-${key}`,
            component: ShipHistoryGroup,
            props: {
              mmsi,
              name
            },
            score: 80,
            children: groupIntervals.map(s => ({
              id: `ship-${s.mmsi}-${s.start_ts}`,
              component: ShipHistoryInterval,
              props: {
                startTs: s.start_ts,
                endTs: s.end_ts,
                duration: s.duration
              },
              onSelect: () => {
                shipStore.selectedHistoryInterval = s;
                shipStore.historyVersion++;
                if (s.lat && s.lon) {
                  api.map.getMapInstance().flyTo({
                    center: [s.lon, s.lat],
                    zoom: 10
                  });
                }
              }
            }))
          });
        }
        return results;
      } catch {
        return [];
      }
    }
  });

  void (async () => {
    try {
      ctx.onDispose(await bindShipStreaming(api));
    } catch (e) {
      console.error("failed initializing ship162 realtime subscription", e);
    }
  })();

  const handleSelectionChanged = (selection: SelectionMap) => {
    const currentIds = selection.get(ENTITY_TYPE) || new Set<string>();

    for (const id of shipStore.selected.keys()) {
      if (!currentIds.has(id)) {
        shipStore.selected.delete(id);
      }
    }

    for (const id of currentIds) {
      if (!shipStore.selected.has(id)) {
        const selectionData: ShipSelectionData = {
          trajectory: [],
          loading: true,
          error: null
        };
        shipStore.selected.set(id, selectionData);
        void ensureTrajectory(api, id);
      }
    }
    shipStore.version++;
  };

  ctx.onDispose(api.selection.onChanged(handleSelectionChanged));

  ctx.onDispose(
    api.bus.subscribe<TrajectoryGetRequest>(TrajectoryApi.TOPIC_GET, async req => {
      if (req.key.type !== ENTITY_TYPE) return;

      const id = req.key.id;
      if (!shipStore.selected.has(id)) {
        const selectionData: ShipSelectionData = {
          trajectory: [],
          loading: true,
          error: null
        };
        shipStore.selected.set(id, selectionData);
      }

      const points = await ensureTrajectory(api, id);

      api.bus.publish<BusResultEnvelope<TrajectoryGetResult>>(
        `${TrajectoryApi.TOPIC_GET}:result`,
        {
          request_id: req.request_id,
          data: { key: req.key, points, source: "tangram_ship162" }
        }
      );
    })
  );
}

async function ensureTrajectory(api: TangramApi, mmsi: string): Promise<unknown[]> {
  const existing = api.trajectory.get({ id: mmsi, type: ENTITY_TYPE }).value;
  if (existing.length > 0) {
    const entry = shipStore.selected.get(mmsi);
    if (entry) {
      const next = existing as Ship162Vessel[];
      const changed =
        entry.loading !== false ||
        entry.error !== null ||
        entry.trajectory.length !== next.length;

      entry.loading = false;
      entry.error = null;
      entry.trajectory = [...next];

      if (changed) {
        shipStore.version++;
      }
    }
    return existing;
  }

  const inFlight = trajectoryFetches.get(mmsi);
  if (inFlight) return inFlight;

  const cached = shipStore.selected.get(mmsi)?.trajectory;
  if (cached && cached.length > 0) return cached;

  const p = fetchTrajectory(api, mmsi).finally(() => trajectoryFetches.delete(mmsi));
  trajectoryFetches.set(mmsi, p);
  return p;
}

async function fetchTrajectory(api: TangramApi, mmsi: string): Promise<unknown[]> {
  const data = shipStore.selected.get(mmsi);
  if (!data) return [];

  const shared = api.trajectory.get({ id: mmsi, type: ENTITY_TYPE }).value;
  if (shared.length > 0) return shared;
  if (data.trajectory.length > 0 && data.loading === false) return data.trajectory;

  try {
    data.loading = true;
    const response = await fetch(`/ship162/data/${mmsi}`);
    if (!response.ok) throw new Error("Failed to fetch trajectory");
    const trajData = await response.json();

    if (shipStore.selected.has(mmsi)) {
      const currentData = shipStore.selected.get(mmsi)!;
      currentData.trajectory = [...trajData, ...currentData.trajectory];
      shipStore.version++;

      api.bus.publish(TrajectoryApi.TOPIC_INIT, {
        key: { id: mmsi, type: ENTITY_TYPE },
        points: currentData.trajectory,
        source: "tangram_ship162"
      });

      return currentData.trajectory;
    }
  } catch (err: unknown) {
    if (shipStore.selected.has(mmsi)) {
      shipStore.selected.get(mmsi)!.error = (err as Error).message;
    }
  } finally {
    if (shipStore.selected.has(mmsi)) {
      shipStore.selected.get(mmsi)!.loading = false;
    }
  }

  return shipStore.selected.get(mmsi)?.trajectory ?? [];
}

async function bindShipStreaming(api: TangramApi): Promise<Disposable> {
  const connectionId = await api.realtime.ensureConnected();
  let subscription: Disposable | null = null;
  let generation = 0;

  const syncStreaming = async (isLive: boolean) => {
    const currentGeneration = ++generation;

    subscription?.dispose();
    subscription = null;

    if (!isLive) {
      await api.realtime.publish("system:leave-streaming", { connectionId });
      return;
    }

    const next = await subscribeToShipData(api, connectionId);
    if (currentGeneration !== generation) {
      next.dispose();
      if (!api.time.isLive.value) {
        await api.realtime.publish("system:leave-streaming", { connectionId });
      }
      return;
    }

    subscription = next;
  };

  await syncStreaming(api.time.isLive.value);

  const stopWatchingLiveMode = watch(
    () => api.time.isLive.value,
    isLive => {
      void syncStreaming(isLive);
    }
  );

  return {
    dispose() {
      generation += 1;
      stopWatchingLiveMode();
      subscription?.dispose();
      subscription = null;
    }
  };
}

async function subscribeToShipData(
  api: TangramApi,
  connectionId: string
): Promise<{ dispose(): void }> {
  const topic = `streaming-${connectionId}:new-ship162-data`;
  try {
    const subscription = await api.realtime.subscribe<{
      ship: Ship162Vessel[];
      count: number;
    }>(topic, payload => {
      const entities: Entity[] = payload.ship.map(ship => ({
        id: ship.mmsi.toString(),
        type: ENTITY_TYPE,
        state: ship
      }));
      api.state.replaceAllEntitiesByType(ENTITY_TYPE, entities);
      api.state.setTotalCount(ENTITY_TYPE, payload.count);

      const entityMap = api.state.getEntitiesByType<Ship162Vessel>(ENTITY_TYPE).value;

      let hasUpdates = false;
      for (const [id, data] of shipStore.selected) {
        const entity = entityMap.get(id);

        if (!entity) {
          if (data.trajectory.length === 0) continue;

          data.trajectory = [];
          data.loading = false;
          data.error = null;
          api.bus.publish(TrajectoryApi.TOPIC_INIT, {
            key: { id, type: ENTITY_TYPE },
            points: [],
            source: "tangram_ship162"
          });
          hasUpdates = true;
          continue;
        }

        if (entity.state.latitude != null && entity.state.longitude != null) {
          const updated = entity.state;
          const last = data.trajectory[data.trajectory.length - 1];
          const timestamp = updated.lastseen ?? updated.timestamp ?? 0;

          if (!last || Math.abs((last.timestamp ?? 0) - timestamp) > 0.5) {
            const point = {
              ...updated,
              timestamp: timestamp
            };
            data.trajectory.push(point);
            api.bus.publish(TrajectoryApi.TOPIC_APPEND, {
              key: { id, type: ENTITY_TYPE },
              points: [point],
              source: "tangram_ship162"
            });
            hasUpdates = true;
          }
        }
      }

      if (hasUpdates) {
        shipStore.version++;
      }
    });
    await api.realtime.publish("system:join-streaming", { connectionId });
    return subscription;
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
    return { dispose: () => {} };
  }
}
