import {
  type PluginContext,
  type Entity,
  type SelectionMap,
  type TangramApi
} from "@open-aviation/tangram-core/api";
import { TrajectoryApi } from "@open-aviation/tangram-core/api";
import DatalinkLayer from "./DatalinkLayer.vue";
import { createAirportName } from "./airport";
import DatalinkInfoWidget from "./DatalinkInfoWidget.vue";
import DatalinkCountWidget from "./DatalinkCountWidget.vue";
import DatalinkFilterWidget from "./DatalinkFilterWidget.vue";
import {
  datalinkStore,
  classifyAndStore,
  ensureHistory,
  getSquitterPayload
} from "./store";
import type { DatalinkMessage } from "./types";

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

interface DatalinkEntityBase {
  id: string;
  label: string;
  lastseen: number;
  latitude?: number | null;
  longitude?: number | null;
  altitude_ft?: number | null;
  track?: number | null;
  messages: number;
}

export type DatalinkAircraftEntity = DatalinkEntityBase & {
  details: { kind: "aircraft"; data: DatalinkAircraftInfo };
};

export type DatalinkStationEntity = DatalinkEntityBase & {
  details: { kind: "station"; data: DatalinkStationInfo };
};

export type DatalinkEntity = DatalinkAircraftEntity | DatalinkStationEntity;

export const isAircraftEntity = (
  entity: DatalinkEntity
): entity is DatalinkAircraftEntity => entity.details.kind === "aircraft";

export const isStationEntity = (
  entity: DatalinkEntity
): entity is DatalinkStationEntity => entity.details.kind === "station";

export interface DatalinkFrontendConfig {
  topbar_order?: number;
  sidebar_order?: number;
}

function normalizeId(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  return String(value);
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

export async function install(ctx: PluginContext, config?: DatalinkFrontendConfig) {
  // metadata is a plugin-level prerequisite. progressive degradation is deferred
  const rs1090 =
    await ctx.importModule<typeof import("rs1090-wasm/web")>("rs1090_wasm.js");
  // NOTE: copied wasm-bindgen loader resolves sibling wasm through import.meta.url
  await rs1090.default();
  rs1090.run();
  const airportName = createAirportName(rs1090);

  const api = ctx.api;

  api.ui.registerWidget("datalink-count-widget", "TopBar", DatalinkCountWidget, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });

  api.ui.registerWidget("datalink-info-widget", "SideBar", DatalinkInfoWidget, {
    pluginId: ctx.id,
    priority: config?.sidebar_order,
    title: "Datalink",
    relevantFor: ENTITY_TYPE,
    props: { airportName }
  });

  api.ui.registerWidget("datalink-layer", "MapOverlay", DatalinkLayer, {
    pluginId: ctx.id,
    props: { airportName }
  });

  api.ui.registerSettingsWidget("datalink-filter", DatalinkFilterWidget);

  api.state.registerEntityType(ENTITY_TYPE, { pluginId: ctx.id });

  void (async () => {
    ctx.onDispose(await bindDatalinkStreaming(api));
    ctx.onDispose(
      await api.realtime.subscribe<DatalinkMessage>("datalink:feed:message", msg => {
        const id = getMessageEntityId(msg);
        // always store in universal history regardless of selection
        classifyAndStore(id, msg);
        // also mirror into selected data for live feed tab
        const data = datalinkStore.selected.get(id);
        if (data) {
          data.messages.unshift(msg);
          if (data.messages.length > 500) data.messages.pop();
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
        // pre-populate messages from universal history
        const hist = ensureHistory(id);
        datalinkStore.selected.set(id, {
          trajectory: [],
          loading: false,
          error: null,
          messages: [...hist.messages]
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
      if (!entity || !isAircraftEntity(entity.state)) continue;

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
