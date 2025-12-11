import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram-core/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";
import { selectedShip } from "./store";

const ENTITY_TYPE = "ship162_ship";

export interface MmsiInfo {
  country: string;
  flag: string;
  "iso-3166-1": string;
}

export interface Ship162Vessel {
  mmsi: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  ship_name: string;
  course: number;
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

export function install(api: TangramApi) {
  api.ui.registerWidget("ship162-count-widget", "TopBar", ShipCountWidget);
  api.ui.registerWidget("ship162-info-widget", "SideBar", ShipInfoWidget);
  api.ui.registerWidget("ship162-ship-layer", "MapOverlay", ShipLayer);
  api.ui.registerWidget("ship162-trail-layer", "MapOverlay", ShipTrailLayer);
  api.state.registerEntityType(ENTITY_TYPE);

  (async () => {
    try {
      const connectionId = await api.realtime.ensureConnected();
      await subscribeToShipData(api, connectionId);
    } catch (e) {
      console.error("failed initializing ship162 realtime subscription", e);
    }
  })();

  watch(
    () => api.state.activeEntity.value,
    async newEntity => {
      if (newEntity?.type === ENTITY_TYPE) {
        if (newEntity.id !== selectedShip.id) {
          selectedShip.id = newEntity.id;
          selectedShip.trajectory = [];
          selectedShip.loading = true;
          selectedShip.error = null;

          try {
            const response = await fetch(`/ship162/data/${newEntity.id}`);
            if (!response.ok) throw new Error("Failed to fetch trajectory");
            const data = await response.json();
            if (selectedShip.id === newEntity.id) {
              selectedShip.trajectory = [...data, ...selectedShip.trajectory];
            }
          } catch (err: unknown) {
            if (selectedShip.id === newEntity.id) {
              selectedShip.error = (err as Error).message;
            }
          } finally {
            if (selectedShip.id === newEntity.id) {
              selectedShip.loading = false;
            }
          }
        }
      } else {
        selectedShip.id = null;
        selectedShip.trajectory = [];
      }
    }
  );
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

        if (selectedShip.id) {
          const entityMap =
            api.state.getEntitiesByType<Ship162Vessel>(ENTITY_TYPE).value;
          const entity = entityMap.get(selectedShip.id);

          if (
            entity &&
            entity.state &&
            entity.state.latitude &&
            entity.state.longitude
          ) {
            const updated = entity.state;
            const last = selectedShip.trajectory[selectedShip.trajectory.length - 1];
            const timestamp = updated.timestamp;

            if (!last || Math.abs(last.timestamp - timestamp) > 0.5) {
              selectedShip.trajectory.push({
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
