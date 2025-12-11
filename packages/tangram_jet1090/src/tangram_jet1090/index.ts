import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram-core/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import AircraftInfoWidget from "./AircraftInfoWidget.vue";
import AircraftTrailLayer from "./AircraftTrailLayer.vue";
import RouteLayer from "./RouteLayer.vue";
import SensorsLayer from "./SensorsLayer.vue";
import { selectedAircraft, pluginConfig } from "./store";

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

  api.ui.registerWidget(
    "jet1090-count-widget",
    "TopBar",
    AircraftCountWidget,
    config?.topbar_order
  );
  api.ui.registerWidget("jet1090-aircraft-layer", "MapOverlay", AircraftLayer);
  api.ui.registerWidget(
    "jet1090-info-widget",
    "SideBar",
    AircraftInfoWidget,
    config?.sidebar_order
  );
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
    () => api.state.activeEntity.value,
    async newEntity => {
      if (newEntity?.type === ENTITY_TYPE) {
        if (newEntity.id !== selectedAircraft.icao24) {
          selectedAircraft.icao24 = newEntity.id;
          selectedAircraft.trajectory = [];
          selectedAircraft.loading = true;
          selectedAircraft.error = null;
          selectedAircraft.route.origin = null;
          selectedAircraft.route.destination = null;

          try {
            const response = await fetch(`/jet1090/data/${newEntity.id}`);
            if (!response.ok) throw new Error("Failed to fetch trajectory");
            const data = await response.json();
            if (selectedAircraft.icao24 === newEntity.id) {
              selectedAircraft.trajectory = [...data, ...selectedAircraft.trajectory];
            }
          } catch (err: unknown) {
            if (selectedAircraft.icao24 === newEntity.id) {
              selectedAircraft.error = (err as Error).message;
            }
          } finally {
            if (selectedAircraft.icao24 === newEntity.id) {
              selectedAircraft.loading = false;
            }
          }
        }
      } else {
        selectedAircraft.icao24 = null;
        selectedAircraft.trajectory = [];
        selectedAircraft.route.origin = null;
        selectedAircraft.route.destination = null;
      }
    }
  );
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

        if (selectedAircraft.icao24) {
          const entityMap =
            api.state.getEntitiesByType<Jet1090Aircraft>(ENTITY_TYPE).value;
          const entity = entityMap.get(selectedAircraft.icao24);

          if (
            entity &&
            entity.state &&
            entity.state.latitude &&
            entity.state.longitude
          ) {
            const updated = entity.state;
            const last =
              selectedAircraft.trajectory[selectedAircraft.trajectory.length - 1];
            // rust sends micros, history sends seconds -> normalising to seconds
            const timestamp = updated.lastseen / 1_000_000;

            if (!last || Math.abs((last.timestamp || 0) - timestamp) > 0.5) {
              selectedAircraft.trajectory.push({
                ...updated,
                timestamp: timestamp
              });
            }
          }
        }
      }
    );
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}