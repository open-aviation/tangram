import {
  App,
  ref,
  Component,
  computed,
  reactive,
  shallowRef,
  watch,
  type ShallowRef,
  type Ref
} from "vue";
import type { Map as MaplibreMap, LngLatBounds, StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
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
  lang: string;
  min_zoom: number;
  max_zoom: number;
  max_pitch: number;
  allow_pitch: boolean;
  allow_bearing: boolean;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  seek(_time: Date): void {
    throw new NotImplementedError();
  }
}

export interface WidgetOptions {
  priority?: number;
  title?: string;
  relevantFor?: string | string[];
}

export interface WidgetEntry extends WidgetOptions {
  id: string;
  priority: number;
  isCollapsed: boolean;
}

export class UiApi {
  private app: App;
  readonly widgets = reactive<Record<WidgetLocation, WidgetEntry[]>>({
    TopBar: [],
    SideBar: [],
    MapOverlay: []
  });

  constructor(app: App) {
    this.app = app;
  }

  registerWidget(
    id: string,
    location: WidgetLocation,
    component: Component,
    options: WidgetOptions = {}
  ): Disposable {
    this.app.component(id, component);

    // TODO: deckgl map overlays order
    const { priority = 0, title, relevantFor } = options;
    const effectivePriority = location === "MapOverlay" ? 0 : priority;

    const widget: WidgetEntry = {
      id,
      priority: effectivePriority,
      title,
      relevantFor,
      isCollapsed: false
    };

    this.widgets[location].push(widget);
    this.widgets[location].sort((a, b) => b.priority - a.priority);

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

  readonly map = shallowRef<MaplibreMap | null>(null);
  private overlay = shallowRef<MapboxOverlay | null>(null);
  readonly layers = shallowRef<Layer[]>([]);
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

  initialize = (mapInstance: MaplibreMap) => {
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
          this.tangramApi.state.clearSelection();
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

  getMapInstance = (): MaplibreMap => {
    if (!this.map.value) {
      throw new Error("map not initialized");
    }
    return this.map.value;
  };

  addLayer(layer: Layer): Disposable {
    this.layers.value = [...this.layers.value, layer];
    return {
      dispose: () => {
        this.layers.value = this.layers.value.filter(l => l !== layer);
      }
    };
  }

  setLayer(layer: Layer): Disposable {
    const index = this.layers.value.findIndex(l => l.id === layer.id);
    if (index >= 0) {
      const newLayers = [...this.layers.value];
      newLayers[index] = layer;
      this.layers.value = newLayers;
    } else {
      this.layers.value = [...this.layers.value, layer];
    }
    return {
      dispose: () => {
        this.layers.value = this.layers.value.filter(l => l.id !== layer.id);
      }
    };
  }
}

// TODO: in the future, entities may simply mean rows in a arrow table (e.g. from a parquet file)
// NOTE: the server may return entities within the map bounding box
// so the entities stored may not represent the full set of entities
// we thus do not provide a "total entity count" in this api.
export class StateApi {
  readonly entitiesByType: Map<string, ShallowRef<Map<EntityId, Entity>>> = new Map();
  readonly totalCounts: Ref<ReadonlyMap<string, number>> = ref(new Map());

  readonly activeEntities = shallowRef<Map<EntityId, Entity>>(new Map());

  registerEntityType = (type: string): void => {
    if (!this.entitiesByType.has(type)) {
      this.entitiesByType.set(type, shallowRef(new Map()));
    }
  };

  getEntitiesByType = <T extends EntityState>(
    type: string
  ): Ref<ReadonlyMap<EntityId, Entity<T>>> => {
    if (!this.entitiesByType.has(type)) {
      this.entitiesByType.set(type, shallowRef(new Map()));
    }
    return this.entitiesByType.get(type) as Ref<ReadonlyMap<EntityId, Entity<T>>>;
  };

  replaceAllEntitiesByType = (type: string, newEntities: Entity[]): void => {
    let bucket = this.entitiesByType.get(type);
    if (!bucket) {
      bucket = shallowRef(new Map());
      this.entitiesByType.set(type, bucket);
    }

    const newMap = new Map<EntityId, Entity>();
    for (const entity of newEntities) {
      newMap.set(entity.id, entity);
    }
    bucket.value = newMap;

    const currentActive = new Map(this.activeEntities.value);
    let changed = false;
    for (const [id, entity] of currentActive) {
      if (entity.type === type) {
        const fresh = newMap.get(id);
        if (fresh) {
          currentActive.set(id, fresh);
          changed = true;
        }
      }
    }
    if (changed) {
      this.activeEntities.value = currentActive;
    }
  };

  selectEntity = (entity: Entity, exclusive: boolean = true): void => {
    if (exclusive) {
      const newMap = new Map();
      newMap.set(entity.id, entity);
      this.activeEntities.value = newMap;
    } else {
      const newMap = new Map(this.activeEntities.value);
      newMap.set(entity.id, entity);
      this.activeEntities.value = newMap;
    }
  };

  deselectEntity = (entityId: EntityId): void => {
    const newMap = new Map(this.activeEntities.value);
    if (newMap.delete(entityId)) {
      this.activeEntities.value = newMap;
    }
  };

  clearSelection = (): void => {
    if (this.activeEntities.value.size > 0) {
      this.activeEntities.value = new Map();
    }
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
  private joinPromises: Map<string, Promise<Channel>> = new Map();

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
    const body: Record<string, string> = { channel };
    if (this.connectionId) {
      body.id = this.connectionId;
    }

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      throw new Error(`failed to fetch token: ${resp.statusText}`);
    }
    return resp.json();
  }

  private connect(): Promise<void> {
    if (!this.connectionPromise) {
      this.connectionPromise = (async () => {
        try {
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
        } catch (e) {
          this.connectionPromise = null;
          throw e;
        }
      })();
    }
    return this.connectionPromise!;
  }

  /**
   * Multiple plugins can subscribe to the *same* Phoenix channel topic,
   * e.g. `streaming-<conn_id>` but listen to different events (e.g.
   * `new-jet1090-data` or `new-ship162-data`).
   *
   * To avoid two plugins racing to create a channel instance which can
   * overwrite each other, we store in-flight join promises in `joinPromises`
   * map so both plugins receive the same `Channel` instance.
   */
  private async getChannel(topic: string): Promise<Channel> {
    await this.connect();
    if (!this.socket) throw new Error("socket connection failed");

    if (this.joinPromises.has(topic)) {
      return this.joinPromises.get(topic)!;
    }

    if (this.channels.has(topic)) {
      const channel = this.channels.get(topic)!;
      if (channel.state === "joined") {
        return channel;
      }
    }

    const joinPromise = (async () => {
      try {
        let channel = this.channels.get(topic);
        if (!channel) {
          const { token } = await this.fetchToken(topic);
          channel = this.socket!.channel(topic, { token });
          this.channels.set(topic, channel);
        }

        if (channel.state === "joined") return channel;

        await new Promise<void>((resolve, reject) => {
          channel!
            .join()
            .receive("ok", () => resolve())
            .receive("error", reason => reject(reason))
            .receive("timeout", () => reject("channel join timeout"));
        });
        return channel!;
      } catch (e) {
        this.channels.delete(topic);
        throw e;
      }
    })();

    this.joinPromises.set(topic, joinPromise);
    try {
      return await joinPromise;
    } finally {
      this.joinPromises.delete(topic);
    }
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

    this.setupViewUpdates();
  }

  private setupViewUpdates() {
    const updateView = () => {
      const connId = this.realtime.getConnectionId();
      if (!connId) return;
      const bounds = this.map.bounds.value;
      if (!bounds) return;

      const selectedEntities = Array.from(this.state.activeEntities.value.values()).map(
        e => ({
          id: e.id,
          typeName: e.type
        })
      );

      const payload = {
        connectionId: connId,
        northEastLat: bounds.getNorthEast().lat,
        northEastLng: bounds.getNorthEast().lng,
        southWestLat: bounds.getSouthWest().lat,
        southWestLng: bounds.getSouthWest().lng,
        selectedEntities: selectedEntities
      };
      this.realtime.publish("system:bound-box", payload);
    };

    watch(this.map.bounds, updateView, { deep: true });
    watch(this.state.activeEntities, updateView, { deep: true });
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
