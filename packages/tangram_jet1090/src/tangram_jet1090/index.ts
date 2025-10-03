import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import AircraftInfoWidget from "./AircraftInfoWidget.vue";
import AircraftTrailLayer from "./AircraftTrailLayer.vue";
import SensorsLayer from "./SensorsLayer.vue";
import init, { run } from "rs1090-wasm";

interface RawAircraft {
  icao24: string;
  [key: string]: any;
}

export function install(api: TangramApi) {
  // initialising webassembly manually because esm build isn't supported well
  (async () => {
    await init("/rs1090_wasm_bg.wasm");
    run();
  })();
  api.ui.registerWidget("jet1090-count-widget", "TopBar", AircraftCountWidget);
  api.ui.registerWidget("jet1090-aircraft-layer", "MapOverlay", AircraftLayer);
  api.ui.registerWidget("jet1090-info-widget", "SideBar", AircraftInfoWidget);
  api.ui.registerWidget("jet1090-trail-layer", "MapOverlay", AircraftTrailLayer);
  api.ui.registerWidget("jet1090-sensors-layer", "MapOverlay", SensorsLayer);

  api.state.registerEntityType("aircraft");

  (async () => {
    try {
      const connectionId = await api.realtime.ensureConnected();
      await subscribeToAircraftData(api, connectionId);
    } catch (e) {
      console.error("failed initializing jet1090 realtime subscription", e);
    }
  })();

  watch(
    api.map.bounds,
    newBounds => {
      const connId = api.realtime.getConnectionId();
      if (!connId) return;
      const payload = {
        connectionId: connId,
        northEastLat: newBounds.getNorthEast().lat,
        northEastLng: newBounds.getNorthEast().lng,
        southWestLat: newBounds.getSouthWest().lat,
        southWestLng: newBounds.getSouthWest().lng
      };
      api.realtime.publish("system:bound-box", payload);
    },
    { deep: true }
  );
}

async function subscribeToAircraftData(api: TangramApi, connectionId: string) {
  const topic = `streaming-${connectionId}:new-data`;
  try {
    await api.realtime.subscribe<{ aircraft: RawAircraft[]; count: number }>(
      topic,
      payload => {
        const entities: Entity[] = payload.aircraft.map(ac => ({
          id: ac.icao24,
          type: "aircraft",
          state: ac
        }));
        api.state.replaceAllEntitiesByType("aircraft", entities);
        // FIXME: right now we assume all entities come from jet1090. not a good idea.
        api.state.setTotalCount(payload.count);
      }
    );
    await api.realtime.publish("system:join-streaming", { connectionId });
  } catch (e) {
    console.error(`failed to subscribe to ${topic}`, e);
  }
}
