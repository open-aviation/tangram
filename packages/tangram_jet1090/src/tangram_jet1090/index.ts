import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";

interface RawAircraft {
  icao24: string;
  [key: string]: any;
}

export function install(api: TangramApi) {
  api.ui.registerWidget("jet1090-count-widget", "TopBar", AircraftCountWidget);
  api.ui.registerWidget("jet1090-aircraft-layer", "MapOverlay", AircraftLayer);

  api.state.registerEntityType("aircraft");

  const stopWatch = watch(
    api.realtime.connectionId,
    newId => {
      if (newId) {
        subscribeToAircraftData(api, newId);
        stopWatch();
      }
    },
    { immediate: true }
  );
  watch(
    api.map.bounds,
    newBounds => {
      if (!api.realtime.connectionId.value) return;
      const payload = {
        connectionId: api.realtime.connectionId.value,
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
