import {
  App,
  ref,
  Component,
  computed,
  reactive,
  shallowRef,
  watch,
  type ShallowRef,
  type Ref,
  type ComputedRef
} from "vue";
import type { Map, LngLatBounds, StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { Socket, Channel } from "phoenix";

class NotImplementedError extends Error {
  constructor(message = "this function is not yet implemented.") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface ChannelConfig {
  url: string;
}

export interface MapConfig {
  style: string | StyleSpecification;
  attribution: string;
  center_lat: number;
  center_lon: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface TangramConfig {
  channel: ChannelConfig;
  map: MapConfig;
}

export type EntityId = string;

export interface Disposable {
  dispose(): void;
}

export interface Entity<TState extends EntityState = EntityState> {
  readonly id: EntityId;
  readonly type: string;
  readonly state: TState;
}

export type EntityState = unknown;

export interface IPosition {
  readonly lat: number;
  readonly lng: number;
}

export interface ITimestamp {
  readonly timestamp: Date;
}

export type WidgetLocation = "TopBar" | "SideBar" | "MapOverlay";

/* Local time. Not to be confused with the server time. */
export class TimeApi implements Disposable {
  readonly now = ref(new Date());
  readonly isPlaying = ref(false);

  constructor() {}

  dispose() {}

  play(): void {
    throw new NotImplementedError();
  }
  pause(): void {
    throw new NotImplementedError();
  }
  seek(time: Date): void {
    throw new NotImplementedError();
  }
}

export class UiApi {
  private app: App;
  readonly widgets = reactive<Record<WidgetLocation, { id: string }[]>>({
    TopBar: [],
    SideBar: [],
    MapOverlay: []
  });
  readonly isSidebarCollapsed = ref(true);

  constructor(app: App) {
    this.app = app;
  }

  openSidebar = (): void => {
    this.isSidebarCollapsed.value = false;
  };

  closeSidebar = (): void => {
    this.isSidebarCollapsed.value = true;
  };

  toggleSidebar = (): void => {
    this.isSidebarCollapsed.value = !this.isSidebarCollapsed.value;
  };

  registerWidget(
    id: string,
    location: WidgetLocation,
    component: Component
  ): Disposable {
    this.app.component(id, component);

    const widget = { id };
    this.widgets[location].push(widget);

    return {
      dispose: () => {
        const locationWidgets = this.widgets[location];
        const index = locationWidgets.findIndex(w => w.id === id);
        if (index > -1) {
          locationWidgets.splice(index, 1);
        }
      }
    };
  }
}
// NOTE: we use arrow functions to capture lexical `this` properly.

export class MapApi implements Disposable {
  private tangramApi: TangramApi;

  constructor(tangramApi: TangramApi) {
    this.tangramApi = tangramApi;
  }

  readonly map = shallowRef<Map | null>(null);
  private overlay = shallowRef<MapboxOverlay | null>(null);
  readonly layers = shallowRef<any[]>([]);
  readonly isReady = computed(() => !!this.map.value);

  readonly center = ref({ lng: 0, lat: 0 });
  readonly zoom = ref(0);
  readonly pitch = ref(0);
  readonly bearing = ref(0);
  readonly bounds: Ref<Readonly<LngLatBounds> | null> = ref(null);

  private updateState = () => {
    if (!this.map.value) return;
    const map = this.map.value;
    this.center.value = map.getCenter();
    this.zoom.value = map.getZoom();
    this.pitch.value = map.getPitch();
    this.bearing.value = map.getBearing();
    (this.bounds as Ref).value = map.getBounds();
  };

  initialize = (mapInstance: Map) => {
    this.map.value = mapInstance;
    this.overlay.value = new MapboxOverlay({
      interleaved: false,
      onHover: info => {
        const canvas = this.map.value?.getCanvas();
        if (canvas) {
          canvas.style.cursor = info.object ? "pointer" : "";
        }
      },
      onClick: info => {
        if (!info.object) {
          this.tangramApi.state.deselectActiveEntity();
        }
      }
    });
    this.map.value.addControl(this.overlay.value);

    watch(
      this.layers,
      newLayers => {
        this.overlay.value?.setProps({ layers: newLayers });
      },
      { deep: true }
    );

    const onMapLoad = () => {
      this.updateState();
      this.map.value?.off("load", onMapLoad);
    };
    this.map.value.on("load", onMapLoad);

    this.map.value.on("moveend", this.updateState);
    this.map.value.on("zoomend", this.updateState);
    this.map.value.on("pitchend", this.updateState);
    this.map.value.on("rotateend", this.updateState);
  };

  dispose = () => {
    this.map.value?.remove();
    this.map.value = null;
  };

  getMapInstance = (): Map => {
    if (!this.map.value) {
      throw new Error("map not initialized");
    }
    return this.map.value;
  };

  addLayer(layer: any): Disposable {
    this.layers.value = [...this.layers.value, layer];
    return {
      dispose: () => {
        this.layers.value = this.layers.value.filter(l => l !== layer);
      }
    };
  }
}

// TODO: how about different entity types? might want to use hashmap-based ECS
// TODO: in the future, entities may simply mean rows in a arrow table (e.g. from a parquet file)
// NOTE: the server may return entities within the map bounding box
// so the entities stored may not represent the full set of entities
// we thus do not provide a "total entity count" in this api.
export class StateApi {
  readonly entities: ShallowRef<ReadonlyMap<EntityId, Entity>> = shallowRef(new Map());
  // TODO: allow multi-selection.
  readonly activeEntityId: Ref<EntityId | null> = ref(null);
  readonly activeEntity: ComputedRef<Entity | null> = computed(() => {
    const id = this.activeEntityId.value;
    return id ? (this.entities.value.get(id) ?? null) : null;
  });
  readonly totalCounts: Ref<ReadonlyMap<string, number>> = ref(new Map());

  private entityTypes = new Set<string>();
  private entitiesByTypeCache: Map<string, ComputedRef<ReadonlyMap<EntityId, Entity>>> =
    new Map();

  registerEntityType = (type: string): void => {
    this.entityTypes.add(type);
  };

  getEntitiesByType = <T extends EntityState>(
    type: string
  ): ComputedRef<ReadonlyMap<EntityId, Entity<T>>> => {
    if (!this.entitiesByTypeCache.has(type)) {
      const computedRef = computed(() => {
        const filteredMap = new Map<EntityId, Entity<T>>();
        for (const entity of this.entities.value.values()) {
          if (entity.type === type) {
            filteredMap.set(entity.id, entity as Entity<T>);
          }
        }
        return filteredMap;
      });
      this.entitiesByTypeCache.set(type, computedRef);
    }
    return this.entitiesByTypeCache.get(type)!;
  };

  replaceAllEntitiesByType = (type: string, newEntities: Entity[]): void => {
    const newMap = new Map(this.entities.value);
    for (const entity of this.entities.value.values()) {
      if (entity.type === type) {
        newMap.delete(entity.id);
      }
    }
    for (const entity of newEntities) {
      newMap.set(entity.id, entity);
    }
    this.entities.value = newMap;
  };

  setActiveEntity = (entityId: EntityId): void => {
    this.activeEntityId.value = entityId;
  };

  deselectActiveEntity = (): void => {
    this.activeEntityId.value = null;
  };

  setTotalCount = (type: string, count: number): void => {
    const newMap = new Map(this.totalCounts.value);
    newMap.set(type, count);
    this.totalCounts.value = newMap;
  };
}

export class RealtimeApi {
  private socket: Socket | null = null;
  private channels: Map<string, Channel> = new Map();
  private channelConfig: ChannelConfig;
  private connectionPromise: Promise<void> | null = null;
  private connectionId: string | null = null;

  constructor(config: TangramConfig) {
    this.channelConfig = config.channel;
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  async ensureConnected(): Promise<string> {
    await this.connect();
    if (!this.connectionId) {
      throw new Error("connection id unavailable after connect");
    }
    return this.connectionId;
  }

  private async fetchToken(channel: string): Promise<{ id: string; token: string }> {
    const tokenUrl = `${this.channelConfig.url}/token`;
    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel })
    });
    if (!resp.ok) {
      throw new Error(`failed to fetch token: ${resp.statusText}`);
    }
    return resp.json();
  }

  private connect(): Promise<void> {
    if (!this.connectionPromise) {
      this.connectionPromise = (async () => {
        if (this.socket?.isConnected()) return;

        const { id, token: userToken } = await this.fetchToken("system");
        this.connectionId = id;

        // NOTE: phoenix appends `/websocket` automatically, do not add it here.
        const socketUrl = this.channelConfig.url.replace(/^http/, "ws");
        this.socket = new Socket(socketUrl, { params: { userToken } });

        await new Promise<void>((resolve, reject) => {
          this.socket!.connect();
          this.socket!.onOpen(() => {
            console.log("ws connected");
            resolve();
          });
          this.socket!.onError(e => {
            console.error("ws connection error:", e);
            this.connectionPromise = null;
            reject(e);
          });
        });
      })();
    }
    return this.connectionPromise!;
  }

  private async getChannel(topic: string): Promise<Channel> {
    await this.connect();
    if (!this.socket) throw new Error("socket connection failed");

    if (this.channels.has(topic)) {
      const channel = this.channels.get(topic)!;
      if (channel.state === "joined") {
        return channel;
      }
    }

    const { token } = await this.fetchToken(topic);
    const channel = this.socket.channel(topic, { token });
    this.channels.set(topic, channel);

    return new Promise((resolve, reject) => {
      channel
        .join()
        .receive("ok", () => resolve(channel))
        .receive("error", reason => reject(reason))
        .receive("timeout", () => reject("channel join timeout"));
    });
  }

  private parseTopicEvent(topic: string): [string, string] {
    const parts = topic.split(":");
    if (parts.length < 2) throw new Error(`invalid topic:event format: ${topic}`);
    const event = parts.pop()!;
    const channelTopic = parts.join(":");
    return [channelTopic, event];
  }

  async subscribe<T>(
    topic: string,
    callback: (payload: T) => void
  ): Promise<Disposable> {
    const [channelTopic, event] = this.parseTopicEvent(topic);
    const channel = await this.getChannel(channelTopic);
    const ref = channel.on(event, callback);
    return { dispose: () => channel.off(event, ref) };
  }

  async publish<T>(topic: string, payload: T): Promise<void> {
    const [channelTopic, event] = this.parseTopicEvent(topic);
    const channel = await this.getChannel(channelTopic);
    channel.push(event, payload);
  }
}

export class TangramApi {
  readonly time: TimeApi;
  readonly ui: UiApi;
  readonly map: MapApi;
  readonly state: StateApi;
  readonly realtime: RealtimeApi;
  readonly config: TangramConfig;

  private constructor(
    private app: App,
    config: TangramConfig
  ) {
    this.config = config;
    this.realtime = new RealtimeApi(config);
    this.ui = new UiApi(this.app);
    this.time = new TimeApi();
    this.map = new MapApi(this);
    this.state = new StateApi();
  }

  public static async create(app: App): Promise<TangramApi> {
    const config: TangramConfig = await fetch("/config").then(res => {
      if (!res.ok) throw new Error("failed to fetch `/config`!");
      return res.json();
    });
    return new TangramApi(app, config);
  }

  getVueApp(): App {
    return this.app;
  }
}
