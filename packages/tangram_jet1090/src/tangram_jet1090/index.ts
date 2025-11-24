import { watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import AircraftInfoWidget from "./AircraftInfoWidget.vue";
import AircraftTrailLayer from "./AircraftTrailLayer.vue";
import SensorsLayer from "./SensorsLayer.vue";
import init, { run } from "rs1090-wasm";
import { selectedAircraft } from "./store";

interface RawAircraft {
  icao24: string;
  lastseen: number;
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

  api.state.registerEntityType("jet1090_aircraft");

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
      if (newEntity?.type === "jet1090_aircraft") {
        if (newEntity.id !== selectedAircraft.icao24) {
          selectedAircraft.icao24 = newEntity.id;
          selectedAircraft.trajectory = [];
          selectedAircraft.loading = true;
          selectedAircraft.error = null;

          try {
            const response = await fetch(`/jet1090/data/${newEntity.id}`);
            if (!response.ok) throw new Error("Failed to fetch trajectory");
            const data = await response.json();
            if (selectedAircraft.icao24 === newEntity.id) {
              selectedAircraft.trajectory = [...data, ...selectedAircraft.trajectory];
            }
          } catch (err: any) {
            if (selectedAircraft.icao24 === newEntity.id) {
              selectedAircraft.error = err.message;
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
      selectedEntityId: selectedAircraft.icao24
    };
    api.realtime.publish("system:bound-box", payload);
  };

  watch(api.map.bounds, updateView, { deep: true });
  watch(() => selectedAircraft.icao24, updateView);
}

async function subscribeToAircraftData(api: TangramApi, connectionId: string) {
  const topic = `streaming-${connectionId}:new-jet1090-data`;
  try {
    await api.realtime.subscribe<{ aircraft: RawAircraft[]; count: number }>(
      topic,
      payload => {
        const entities: Entity[] = payload.aircraft.map(ac => ({
          id: ac.icao24,
          type: "jet1090_aircraft",
          state: ac
        }));
        api.state.replaceAllEntitiesByType("jet1090_aircraft", entities);
        api.state.setTotalCount("jet1090_aircraft", payload.count);

        if (selectedAircraft.icao24) {
          const entityMap =
            api.state.getEntitiesByType<RawAircraft>("jet1090_aircraft").value;
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

            if (!last || Math.abs(last.timestamp - timestamp) > 0.5) {
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
