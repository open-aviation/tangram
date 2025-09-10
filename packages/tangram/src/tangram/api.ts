import {
  App,
  ref,
  Component,
  computed,
  reactive,
  type Ref,
  type ComputedRef
} from "vue";
import L from "leaflet";
import type { LatLngBounds, Layer, Map as LeafletMap } from "leaflet";
import { Socket, Channel } from "phoenix";

class NotImplementedError extends Error {
  constructor(message = "this function is not yet implemented.") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface ChannelConfig {
  host: string;
  port: number;
}

export interface TangramConfig {
  channel: ChannelConfig;
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

  constructor(app: App) {
    this.app = app;
  }

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

export class MapApi {
  readonly bounds: Ref<Readonly<LatLngBounds>> = ref(
    new L.LatLngBounds([0, 0], [0, 0])
  );

  setView(position: { lat: number; lng: number }, zoom: number): void {
    throw new NotImplementedError();
  }
  addLayer(layer: Layer): Disposable {
    throw new NotImplementedError();
  }
  getMapInstance(): LeafletMap {
    throw new NotImplementedError();
  }
}

export class StateApi {
  readonly entities: Ref<ReadonlyMap<EntityId, Entity>> = ref(new Map());
  readonly activeEntityId: Ref<EntityId | null> = ref(null);
  readonly activeEntity: ComputedRef<Entity | null> = computed(() => null);

  registerEntityType(type: string): void {
    throw new NotImplementedError();
  }
  getEntitiesByType<T extends EntityState>(
    type: string
  ): ComputedRef<ReadonlyMap<EntityId, Entity<T>>> {
    throw new NotImplementedError();
  }
  setActiveEntity(entityId: EntityId): void {
    throw new NotImplementedError();
  }
  deselectActiveEntity(): void {
    throw new NotImplementedError();
  }
  upsertEntities(entities: Entity[]): void {
    throw new NotImplementedError();
  }
  removeEntities(entityIds: EntityId[]): void {
    throw new NotImplementedError();
  }
}

export class DataApi {
  fetch(pluginId: string, path: string, options?: RequestInit): Promise<Response> {
    throw new NotImplementedError();
  }
}

export class RealtimeApi {
  private socket: Socket | null = null;
  private channels: Map<string, Channel> = new Map();
  private channelConfig: ChannelConfig;
  private connectionPromise: Promise<void> | null = null;
  public readonly connectionId: Ref<string | null> = ref(null);

  constructor(config: TangramConfig) {
    this.channelConfig = config.channel;
  }

  private async fetchToken(channel: string): Promise<{ id: string; token: string }> {
    const tokenUrl = `http://${this.channelConfig.host}:${this.channelConfig.port}/token`;
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

        const socketUrl = `ws://${this.channelConfig.host}:${this.channelConfig.port}`;
        this.socket = new Socket(socketUrl, { params: { userToken } });

        return new Promise((resolve, reject) => {
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
    return this.connectionPromise;
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
  readonly data: DataApi;
  readonly realtime: RealtimeApi;

  private constructor(
    private app: App,
    config: TangramConfig
  ) {
    this.realtime = new RealtimeApi(config);
    this.ui = new UiApi(this.app);
    this.time = new TimeApi();
    this.map = new MapApi();
    this.state = new StateApi();
    this.data = new DataApi();
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
