import { watch } from "vue";
import type { TangramApi, Entity, SearchResult } from "@open-aviation/tangram-core/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import AircraftInfoWidget from "./AircraftInfoWidget.vue";
import AircraftTrailLayer from "./AircraftTrailLayer.vue";
import RouteLayer from "./RouteLayer.vue";
import SensorsLayer from "./SensorsLayer.vue";
import AircraftResult from "./AircraftResult.vue";
import AircraftHistoryLayer from "./AircraftHistoryLayer.vue";
import AircraftHistoryGroup from "./AircraftHistoryGroup.vue";
import AircraftHistoryInterval from "./AircraftHistoryInterval.vue";
import {
  aircraftStore,
  type AircraftSelectionData,
  pluginConfig,
  type TrailColorOptions,
  type HistoryInterval
} from "./store";

const ENTITY_TYPE = "jet1090_aircraft";

interface Jet1090FrontendConfig {
  show_route_lines: boolean;
  topbar_order: number;
  sidebar_order: number;
  trail_type: "line" | "curtain";
  trail_color: string | TrailColorOptions;
  trail_alpha: number;
  search_channel?: string;
}

export interface Jet1090Aircraft {
  icao24: string;
  lastseen: number;
  callsign?: string;
  registration?: string;
  typecode?: string;
  squawk?: number;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  selected_altitude?: number;
  groundspeed?: number;
  vertical_rate?: number;
  vrate_barometric?: number;
  vrate_inertial?: number;
  track?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  roll?: number;
  heading?: number;
  nacp?: number;
  count: number;
  timestamp?: number; // synthetic, added by frontend
}

interface BackendSearchResult {
  state: Jet1090Aircraft;
  score: number;
}

export function install(api: TangramApi, config?: Jet1090FrontendConfig) {
  const channel = config?.search_channel || "jet1090:search";

  if (config) {
    pluginConfig.showRouteLines = config.show_route_lines;
    pluginConfig.trailType = config.trail_type;
    pluginConfig.trailColor = config.trail_color;
    pluginConfig.trailAlpha = config.trail_alpha;
  }

  api.ui.registerWidget("jet1090-count-widget", "TopBar", AircraftCountWidget, {
    priority: config?.topbar_order
  });
  api.ui.registerWidget("jet1090-aircraft-layer", "MapOverlay", AircraftLayer);
  api.ui.registerWidget("jet1090-info-widget", "SideBar", AircraftInfoWidget, {
    priority: config?.sidebar_order,
    title: "Aircraft Details",
    relevantFor: ENTITY_TYPE
  });
  api.ui.registerWidget("jet1090-trail-layer", "MapOverlay", AircraftTrailLayer);
  api.ui.registerWidget("jet1090-route-layer", "MapOverlay", RouteLayer);
  api.ui.registerWidget("jet1090-sensors-layer", "MapOverlay", SensorsLayer);
  api.ui.registerWidget("jet1090-history-layer", "MapOverlay", AircraftHistoryLayer);

  api.state.registerEntityType(ENTITY_TYPE);

  api.search.registerProvider({
    id: "aircraft",
    name: "Aircraft (Live)",
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
          id: `aircraft-${r.state.icao24}`,
          component: AircraftResult,
          props: {
            registration: r.state.registration,
            icao24: r.state.icao24,
            callsign: r.state.callsign,
            typecode: r.state.typecode
          },
          score: r.score,
          onSelect: () => {
            const entity: Entity = {
              id: r.state.icao24,
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
    id: "flights-history",
    name: "Flights (History)",
    search: async (query, signal) => {
      if (query.length < 3) return [];
      try {
        const res = await fetch(`/jet1090/search?q=${encodeURIComponent(query)}`, {
          signal
        });
        if (!res.ok) return [];
        const intervals: HistoryInterval[] = await res.json();

        const groups = new Map<string, HistoryInterval[]>();
        for (const iv of intervals) {
          const key = `${iv.icao24}|${iv.callsign || "Unknown"}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(iv);
        }

        const results: SearchResult[] = [];
        for (const [key, groupIntervals] of groups) {
          const [icao24, callsign] = key.split("|");

          results.push({
            id: `group-${key}`,
            component: AircraftHistoryGroup,
            props: {
              icao24,
              callsign
            },
            score: 80,
            children: groupIntervals.map(f => ({
              id: `flight-${f.icao24}-${f.start_ts}`,
              component: AircraftHistoryInterval,
              props: {
                startTs: f.start_ts,
                endTs: f.end_ts,
                duration: f.duration
              },
              onSelect: () => {
                aircraftStore.selectedHistoryInterval = f;
                aircraftStore.historyVersion++;
                if (f.lat && f.lon) {
                  api.map.getMapInstance().flyTo({
                    center: [f.lon, f.lat],
                    zoom: 8
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
      await subscribeToAircraftData(api, connectionId);
    } catch (e) {
      console.error("failed initializing jet1090 realtime subscription", e);
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

      for (const id of aircraftStore.selected.keys()) {
        if (!currentIds.has(id)) {
          aircraftStore.selected.delete(id);
        }
      }

      for (const id of currentIds) {
        if (!aircraftStore.selected.has(id)) {
          const selectionData: AircraftSelectionData = {
            trajectory: [],
            loading: true,
            error: null,
            route: { origin: null, destination: null }
          };
          aircraftStore.selected.set(id, selectionData);
          fetchTrajectory(id);
        }
      }
      aircraftStore.version++;
    }
  );
}

async function fetchTrajectory(icao24: string) {
  const data = aircraftStore.selected.get(icao24);
  if (!data) return;

  try {
    const response = await fetch(`/jet1090/data/${icao24}`);
    if (!response.ok) throw new Error("Failed to fetch trajectory");
    const trajData = await response.json();

    if (aircraftStore.selected.has(icao24)) {
      const currentData = aircraftStore.selected.get(icao24)!;
      currentData.trajectory = [...trajData, ...currentData.trajectory];
      aircraftStore.version++;
    }
  } catch (err: unknown) {
    if (aircraftStore.selected.has(icao24)) {
      aircraftStore.selected.get(icao24)!.error = (err as Error).message;
    }
  } finally {
    if (aircraftStore.selected.has(icao24)) {
      aircraftStore.selected.get(icao24)!.loading = false;
    }
  }
}

async function subscribeToAircraftData(api: TangramApi, connectionId: string) {
  const topic = `streaming-${connectionId}:new-jet1090-data`;
  try {
    await api.realtime.subscribe<{ aircraft: Jet1090Aircraft[]; count: number }>(
      topic,
      payload => {
        const entities: Entity[] = payload.aircraft.map(ac => ({
          id: ac.icao24,
          type: ENTITY_TYPE,
          state: ac
        }));
        api.state.replaceAllEntitiesByType(ENTITY_TYPE, entities);
        api.state.setTotalCount(ENTITY_TYPE, payload.count);

        let hasUpdates = false;
        for (const [id, data] of aircraftStore.selected) {
          const entityMap =
            api.state.getEntitiesByType<Jet1090Aircraft>(ENTITY_TYPE).value;
          const entity = entityMap.get(id);

          if (
            entity &&
            entity.state &&
            entity.state.latitude &&
            entity.state.longitude
          ) {
            const updated = entity.state;
            const last = data.trajectory[data.trajectory.length - 1];
            const timestamp = updated.lastseen / 1_000_000;

            if (!last || Math.abs((last.timestamp || 0) - timestamp) > 0.5) {
              data.trajectory.push({
                ...updated,
                timestamp: timestamp
              });
              hasUpdates = true;
            }
          }
        }
        if (hasUpdates) {
          aircraftStore.version++;
        }
      }
    );
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}
