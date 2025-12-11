import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram-core/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import AircraftInfoWidget from "./AircraftInfoWidget.vue";
import AircraftTrailLayer from "./AircraftTrailLayer.vue";
import RouteLayer from "./RouteLayer.vue";
import SensorsLayer from "./SensorsLayer.vue";
import { aircraftStore, type AircraftSelectionData, pluginConfig } from "./store";

const ENTITY_TYPE = "jet1090_aircraft";

interface Jet1090FrontendConfig {
  show_route_lines: boolean;
  topbar_order: number;
  sidebar_order: number;
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
export function install(api: TangramApi, config?: Jet1090FrontendConfig) {
  if (config) {
    pluginConfig.showRouteLines = config.show_route_lines;
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

  api.state.registerEntityType(ENTITY_TYPE);

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
