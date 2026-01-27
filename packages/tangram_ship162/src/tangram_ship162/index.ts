import { watch } from "vue";
import type { TangramApi, Entity, SearchResult } from "@open-aviation/tangram-core/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";
import ShipResult from "./ShipResult.vue";
import ShipHistoryLayer from "./ShipHistoryLayer.vue";
import ShipHistoryGroup from "./ShipHistoryGroup.vue";
import ShipHistoryInterval from "./ShipHistoryInterval.vue";
import { shipStore, type ShipSelectionData, type HistoryInterval } from "./store";

const ENTITY_TYPE = "ship162_ship";

interface Ship162FrontendConfig {
  topbar_order: number;
  sidebar_order: number;
  search_channel?: string;
}

export interface MmsiInfo {
  country: string;
  flag: string;
  "iso-3166-1": string;
}

export interface Ship162Vessel {
  mmsi: string;
  timestamp: number;
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

export function install(api: TangramApi, config?: Ship162FrontendConfig) {
  const channel = config?.search_channel || "ship162:search";

  api.ui.registerWidget("ship162-count-widget", "TopBar", ShipCountWidget, {
    priority: config?.topbar_order
  });
  api.ui.registerWidget("ship162-info-widget", "SideBar", ShipInfoWidget, {
    priority: config?.sidebar_order,
    title: "Ship Details",
    relevantFor: ENTITY_TYPE
  });
  api.ui.registerWidget("ship162-ship-layer", "MapOverlay", ShipLayer);
  api.ui.registerWidget("ship162-trail-layer", "MapOverlay", ShipTrailLayer);
  api.ui.registerWidget("ship162-history-layer", "MapOverlay", ShipHistoryLayer);

  api.state.registerEntityType(ENTITY_TYPE);

  api.search.registerProvider({
    id: "ships",
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
            api.state.selectEntity(entity);

            if (r.state.latitude && r.state.longitude) {
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

  (async () => {
    try {
      const connectionId = await api.realtime.ensureConnected();
      await subscribeToShipData(api, connectionId);
    } catch (e) {
      console.error("failed initializing ship162 realtime subscription", e);
    }
  })();

  watch(
    () => api.state.activeEntities.value,
    async newEntities => {
      const currentIds = new Set<string>();
      for (const [id, entity] of newEntities) {
        if (entity.type === ENTITY_TYPE) {
          currentIds.add(id);
        }
      }

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
          fetchTrajectory(id);
        }
      }
      shipStore.version++;
    }
  );
}

async function fetchTrajectory(mmsi: string) {
  const data = shipStore.selected.get(mmsi);
  if (!data) return;

  try {
    const response = await fetch(`/ship162/data/${mmsi}`);
    if (!response.ok) throw new Error("Failed to fetch trajectory");
    const trajData = await response.json();

    if (shipStore.selected.has(mmsi)) {
      const currentData = shipStore.selected.get(mmsi)!;
      currentData.trajectory = [...trajData, ...currentData.trajectory];
      shipStore.version++;
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
}

async function subscribeToShipData(api: TangramApi, connectionId: string) {
  const topic = `streaming-${connectionId}:new-ship162-data`;
  try {
    await api.realtime.subscribe<{ ship: Ship162Vessel[]; count: number }>(
      topic,
      payload => {
        const entities: Entity[] = payload.ship.map(ship => ({
          id: ship.mmsi.toString(),
          type: ENTITY_TYPE,
          state: ship
        }));
        api.state.replaceAllEntitiesByType(ENTITY_TYPE, entities);
        api.state.setTotalCount(ENTITY_TYPE, payload.count);

        let hasUpdates = false;
        for (const [id, data] of shipStore.selected) {
          const entityMap =
            api.state.getEntitiesByType<Ship162Vessel>(ENTITY_TYPE).value;
          const entity = entityMap.get(id);

          if (
            entity &&
            entity.state &&
            entity.state.latitude &&
            entity.state.longitude
          ) {
            const updated = entity.state;
            const last = data.trajectory[data.trajectory.length - 1];
            const timestamp = updated.timestamp;

            if (!last || Math.abs(last.timestamp - timestamp) > 0.5) {
              data.trajectory.push({
                ...updated,
                timestamp: timestamp
              });
              hasUpdates = true;
            }
          }
        }
        if (hasUpdates) {
          shipStore.version++;
        }
      }
    );
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}
