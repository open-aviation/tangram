import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram/api";
import ShipLayer from "./ShipLayer.vue";
import ShipCountWidget from "./ShipCountWidget.vue";
import ShipInfoWidget from "./ShipInfoWidget.vue";
import ShipTrailLayer from "./ShipTrailLayer.vue";

interface RawShip {
  mmsi: string;
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
    api.map.bounds,
    newBounds => {
      const connId = api.realtime.getConnectionId();
      if (!connId || !newBounds) return;
      const payload = {
        connectionId: connId,
        northEastLat: newBounds.getNorthEast().lat,
        northEastLng: newBounds.getNorthEast().lng,
        southWestLat: newBounds.getSouthWest().lat,
        southWestLng: newBounds.getSouthWest().lng
      };
      api.realtime.publish("system:bound-box", payload);
    },
    { deep: true, immediate: true }
  );
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
    });
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}
