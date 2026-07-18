import type { Entity, PluginContext } from "@open-aviation/tangram-core/api";
import AircraftLayer from "./AircraftLayer.vue";
import AircraftCountWidget from "./AircraftCountWidget.vue";
import SimControlWidget from "./SimControlWidget.vue";
import { miniskyStore, type MiniskyAircraft, type SimInfo } from "./store";

export const ENTITY_TYPE = "minisky_aircraft";

interface MiniskyFrontendConfig {
  channel: string;
  topbar_order: number;
  sidebar_order: number;
}

interface StreamPayload {
  aircraft: MiniskyAircraft[];
  count: number;
  siminfo: SimInfo;
}

export function install(ctx: PluginContext, config?: MiniskyFrontendConfig) {
  const api = ctx.api;
  const channel = config?.channel || "minisky";

  api.state.registerEntityType(ENTITY_TYPE, { pluginId: ctx.id });

  api.ui.registerWidget("minisky-count-widget", "TopBar", AircraftCountWidget, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });
  api.ui.registerWidget("minisky-aircraft-layer", "MapOverlay", AircraftLayer, {
    pluginId: ctx.id
  });
  api.ui.registerWidget("minisky-control-widget", "SideBar", SimControlWidget, {
    pluginId: ctx.id,
    priority: config?.sidebar_order,
    title: "MiniSky Simulator"
  });

  void (async () => {
    try {
      await api.realtime.ensureConnected();

      ctx.onDispose(
        await api.realtime.subscribe<StreamPayload>(
          `${channel}:new-data`,
          payload => {
            const entities: Entity[] = payload.aircraft
              .filter(ac => ac.latitude != null && ac.longitude != null)
              .map(ac => ({
                id: ac.id,
                type: ENTITY_TYPE,
                state: ac
              }));
            api.state.replaceAllEntitiesByType(ENTITY_TYPE, entities);
            api.state.setTotalCount(ENTITY_TYPE, payload.count);
            miniskyStore.siminfo = payload.siminfo;
            miniskyStore.connected = true;
            miniskyStore.lastUpdate = Date.now();
          }
        )
      );

      ctx.onDispose(
        await api.realtime.subscribe<{ connected: boolean }>(
          `${channel}:status`,
          payload => {
            miniskyStore.connected = payload.connected;
            if (!payload.connected) {
              api.state.replaceAllEntitiesByType(ENTITY_TYPE, []);
              api.state.setTotalCount(ENTITY_TYPE, 0);
            }
          }
        )
      );
    } catch (e) {
      console.error("tangram_minisky: realtime subscription failed", e);
    }
  })();
}
