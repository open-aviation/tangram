import {
  type PluginContext,
  type Entity,
  type SelectionMap,
  type TangramApi
} from "@open-aviation/tangram-core/api";
import { TrajectoryApi } from "@open-aviation/tangram-core/api";
import DatalinkLayer from "./DatalinkLayer.vue";
import DatalinkInfoWidget from "./DatalinkInfoWidget.vue";
import DatalinkCountWidget from "./DatalinkCountWidget.vue";
import { datalinkStore, type DatalinkMessage } from "./store";

export const ENTITY_TYPE = "datalink_entity";

export type DatalinkEntityKind = "aircraft" | "station";

export interface DatalinkAircraftInfo {
  icao24?: string | null;
  registration?: string | null;
  aircraft_id?: string | null;
  flight_id?: string | null;
}

export interface DatalinkStationInfo {
  station: string;
  airport?: string | null;
  hexcode?: string | null;
  link_type?: string | null;
  provider?: string | null;
  frequency_mhz?: number | null;
  supported_frequencies_mhz?: number[];
}

export interface DatalinkEntity {
  kind: DatalinkEntityKind;
  id: string;
  label: string;
  lastseen: number;
  latitude?: number | null;
  longitude?: number | null;
  altitude_ft?: number | null;
  track?: number | null;
  messages: number;
  aircraft?: DatalinkAircraftInfo | null;
  station?: DatalinkStationInfo | null;
}

export interface DatalinkFrontendConfig {
  topbar_order?: number;
  sidebar_order?: number;
}

function normalizeId(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  return String(value);
}

function getSquitterPayload(msg: DatalinkMessage): any | null {
  const app = msg.app as any;
  if (app && typeof app === "object") {
    if (app.Squitter) return app.Squitter;
    if (app.SQ) return app.SQ;
    if (app.station) return app;
  }
  if ((msg as any).Squitter) return (msg as any).Squitter;
  if ((msg as any).SQ) return (msg as any).SQ;
  return null;
}

export function getMessageEntityId(msg: DatalinkMessage) {
  const squitter = getSquitterPayload(msg);
  if (squitter?.station) return String(squitter.station);
  if (squitter?.airport) return String(squitter.airport);

  return (
    normalizeId(msg.aircraft?.icao24) ||
    normalizeId(msg.aircraft?.registration) ||
    normalizeId(msg.flight_id) ||
    normalizeId(msg.aircraft?.aircraft_id) ||
    "unknown"
  );
}

export function install(ctx: PluginContext, config?: DatalinkFrontendConfig) {
  const api = ctx.api;

  api.ui.registerWidget("datalink-count-widget", "TopBar", DatalinkCountWidget, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });

  api.ui.registerWidget("datalink-info-widget", "SideBar", DatalinkInfoWidget, {
    pluginId: ctx.id,
    priority: config?.sidebar_order,
    title: "Datalink",
    relevantFor: ENTITY_TYPE
  });

  api.ui.registerWidget("datalink-layer", "MapOverlay", DatalinkLayer, {
    pluginId: ctx.id
  });

  api.state.registerEntityType(ENTITY_TYPE, { pluginId: ctx.id });

  void (async () => {
    ctx.onDispose(await bindDatalinkStreaming(api));
    ctx.onDispose(
      await api.realtime.subscribe<DatalinkMessage>("datalink:feed:message", msg => {
        const id = getMessageEntityId(msg);
        const data = datalinkStore.selected.get(id);
        if (data) {
          // ephermal frontend only history store, tangram history probably isn't a good fit
          // for highly unstructured data
          data.messages.unshift(msg);
          if (data.messages.length > 500) {
            data.messages.pop();
          }
        }
      })
    );
  })();

  const handleSelectionChanged = (selection: SelectionMap) => {
    const currentIds = selection.get(ENTITY_TYPE) || new Set<string>();
    datalinkStore.selectedIds = new Set(currentIds);

    for (const id of datalinkStore.selected.keys()) {
      if (!currentIds.has(id)) {
        datalinkStore.selected.delete(id);
      }
    }

    for (const id of currentIds) {
      if (!datalinkStore.selected.has(id)) {
        datalinkStore.selected.set(id, {
          trajectory: [],
          loading: false,
          error: null,
          messages: []
        });
      }
    }
  };
  ctx.onDispose(api.selection.onChanged(handleSelectionChanged));
}

async function bindDatalinkStreaming(api: TangramApi) {
  const connectionId = await api.realtime.ensureConnected();
  const topic = `streaming-${connectionId}:new-datalink-data`;
  const subscription = await api.realtime.subscribe<{
    entities: DatalinkEntity[];
    count: number;
  }>(topic, payload => {
    const entities: Entity[] = payload.entities.map(entity => ({
      id: entity.id,
      type: ENTITY_TYPE,
      state: entity
    }));
    api.state.replaceAllEntitiesByType(ENTITY_TYPE, entities);
    api.state.setTotalCount(ENTITY_TYPE, payload.count);

    const entityMap = api.state.getEntitiesByType<DatalinkEntity>(ENTITY_TYPE).value;

    let hasUpdates = false;
    for (const [id, data] of datalinkStore.selected) {
      const entity = entityMap.get(id);
      if (!entity || entity.state.kind !== "aircraft") continue;

      if (entity.state.latitude != null && entity.state.longitude != null) {
        const updated = entity.state;
        const last = data.trajectory[data.trajectory.length - 1];
        const timestamp = updated.lastseen;

        if (!last || Math.abs((last.lastseen || 0) - timestamp) > 0.5) {
          const point = { ...updated, timestamp };
          data.trajectory.push(point);
          api.bus.publish(TrajectoryApi.TOPIC_APPEND, {
            key: { id, type: ENTITY_TYPE },
            points: [point],
            source: "tangram_datalink"
          });
          hasUpdates = true;
        }
      }
    }

    if (hasUpdates) {
      datalinkStore.version++;
    }
  });
  await api.realtime.publish("system:join-streaming", { connectionId });
  return subscription;
}
