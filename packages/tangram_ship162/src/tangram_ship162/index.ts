import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram-core/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";
import { selectedShip } from "./store";

interface RawShip {
  mmsi: string;
  timestamp: number;
  [key: string]: any;
}

export function install(api: TangramApi) {
  api.ui.registerWidget("ship162-count-widget", "TopBar", ShipCountWidget);
  api.ui.registerWidget("ship162-info-widget", "SideBar", ShipInfoWidget);
  api.ui.registerWidget("ship162-ship-layer", "MapOverlay", ShipLayer);
  api.ui.registerWidget("ship162-trail-layer", "MapOverlay", ShipTrailLayer);
  api.state.registerEntityType("ship162_ship");

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
      if (newEntity?.type === "ship162_ship") {
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
          } catch (err: any) {
            if (selectedShip.id === newEntity.id) {
              selectedShip.error = err.message;
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

  const updateView = () => {
    const connId = api.realtime.getConnectionId();
    if (!connId) return;
    const bounds = api.map.bounds.value;
    if (!bounds) return;

    const payload = {
      connectionId: connId,
      northEastLat: bounds.getNorthEast().lat,
      northEastLng: bounds.getNorthEast().lng,
      southWestLat: bounds.getSouthWest().lat,
      southWestLng: bounds.getSouthWest().lng,
      selectedEntityId: selectedShip.id
    };
    api.realtime.publish("system:bound-box", payload);
  };

  watch(api.map.bounds, updateView, { deep: true });
  watch(() => selectedShip.id, updateView);
}

async function subscribeToShipData(api: TangramApi, connectionId: string) {
  const topic = `streaming-${connectionId}:new-ship162-data`;
  try {
    await api.realtime.subscribe<{ ship: RawShip[]; count: number }>(topic, payload => {
      const entities: Entity[] = payload.ship.map(ship => ({
        id: ship.mmsi.toString(),
        type: "ship162_ship",
        state: ship
      }));
      api.state.replaceAllEntitiesByType("ship162_ship", entities);
      api.state.setTotalCount("ship162_ship", payload.count);

      if (selectedShip.id) {
        const entityMap = api.state.getEntitiesByType<RawShip>("ship162_ship").value;
        const entity = entityMap.get(selectedShip.id);

        if (entity && entity.state && entity.state.latitude && entity.state.longitude) {
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
    });
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}
