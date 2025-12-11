import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram-core/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";
import { shipStore, type ShipSelectionData } from "./store";

const ENTITY_TYPE = "ship162_ship";

interface Ship162FrontendConfig {
  topbar_order: number;
  sidebar_order: number;
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

export function install(api: TangramApi, config?: Ship162FrontendConfig) {
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
