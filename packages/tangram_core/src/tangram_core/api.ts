import {
  App,
  ref,
  Component,
  computed,
  reactive,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  watch,
  type ShallowRef,
  type Ref
} from "vue";
import type { Map as MaplibreMap, LngLatBounds, StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { Socket, Channel } from "phoenix";
import MapSettings from "./MapSettings.vue";
import ThemeSettings from "./ThemeSettings.vue";

class NotImplementedError extends Error {
  constructor(message = "this function is not yet implemented.") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export type Url = string;

export interface ChannelConfig {
  url: Url;
}

export interface MapConfig {
  // style name (string) from the backend is resolved into StyleSpecification in App.vue.
  style: Url | StyleSpecification;
  styles: (Url | StyleSpecification)[];
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

export interface ThemeDefinition {
  name: string;
  background: string;
  foreground: string;
  surface: string;
  border: string;
  hover: string;
  accent1: string;
  accent1_foreground: string;
  accent2: string;
  accent2_foreground: string;
  muted: string;
  error: string;
}

export interface AdaptiveTheme {
  light: string;
  dark: string;
}

export interface ThemeConfig {
  active: string | AdaptiveTheme;
  definitions: ThemeDefinition[];
}

export interface CoreConfig {
  theme: string | AdaptiveTheme;
  themes: ThemeDefinition[];
}

export interface TangramConfig {
  channel: ChannelConfig;
  map: MapConfig;
  core: CoreConfig;
}

export type EntityId = string;

export interface Disposable {
  dispose(): void;
}

function createDisposable(dispose: () => void): Disposable {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      dispose();
    }
  };
}

function bindDisposableToCurrentScope<T extends Disposable>(disposable: T): T {
  if (getCurrentScope()) {
    onScopeDispose(() => disposable.dispose());
  }
  return disposable;
}

/**
 * A stable cross-plugin identifier for an entity.
 *
 * `id` alone is not globally unique (e.g. different entity types may use
 * overlapping identifier spaces), so we always pair it with a `type`.
 */
export interface EntityKey {
  /** The stable identifier within the type, e.g. aircraft `icao24` or ship `mmsi` */
  id: EntityId;
  /**
   * A plugin-defined entity kind, e.g. "jet1090_aircraft" or "ship162_ship".
   *
   * This is part of the cross-plugin contract. It should be stable.
   */
  type: string;
}

/** Map of the entity type to the selected ids */
export type SelectionMap = ReadonlyMap<string, ReadonlySet<EntityId>>;

export interface SelectionChangedPayload {
  selection: SelectionMap;
}

export interface TrajectoryInitPayload {
  key: EntityKey;
  /**
   * Intentionally plugin-agnostic; providers may publish any point structure.
   *
   * Assumption: the schema does not change.
   */
  points: unknown[];
  source?: string;
}

export interface TrajectoryAppendPayload {
  key: EntityKey;
  points: unknown[];
  source?: string;
}

/**
 * Envelope received by providers for `TrajectoryApi.TOPIC_GET`.
 */
export interface TrajectoryGetRequest {
  request_id: string; // injected by BusApi.request()
  key: EntityKey;
}

/** Data payload returned by a trajectory provider. */
export interface TrajectoryGetResult {
  key: EntityKey;
  points: unknown[];
  source?: string;
}

/** Generic response envelope emitted on `${topic}:result`. */
export interface BusResultEnvelope<T> {
  request_id: string;
  data: T;
}

/**
 * A small, plugin-agnostic frontend pubsub bus built on `EventTarget`.
 *
 * - decouple plugins (no direct imports or hardcoded HTTP routes)
 * - make communication patterns mirror the backend's pubsub (Redis), but
 *   with nicer ergonomics for the frontend
 *
 * Assumptions:
 *
 * - topics are stringly-typed; tangram_core exports canonical topic constants
 *   for shared protocols.
 * - payload schemas are stable per topic+version. If a payload schema must change,
 *   introduce a new topic (or suffix with a version) rather than mutating in place
 */
export class BusApi {
  private target = new EventTarget();

  subscribe<T>(
    topic: string,
    handler: (payload: T) => void,
    opts: { signal?: AbortSignal } = {}
  ): Disposable {
    const listener = (evt: Event) => {
      const ce = evt as CustomEvent;
      handler(ce.detail as T);
    };
    this.target.addEventListener(topic, listener as EventListener);

    const disposable = createDisposable(() => {
      this.target.removeEventListener(topic, listener as EventListener);
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        disposable.dispose();
      } else {
        opts.signal.addEventListener("abort", () => disposable.dispose(), {
          once: true
        });
      }
    }

    return bindDisposableToCurrentScope(disposable);
  }

  publish<T>(topic: string, payload: T, opts: { async?: boolean } = {}): void {
    const dispatch = () => {
      this.target.dispatchEvent(new CustomEvent(topic, { detail: payload }));
    };
    if (opts.async) {
      queueMicrotask(dispatch);
    } else {
      dispatch();
    }
  }

  /**
   * Request/response helper.
   *
   * - publishes the request on `topic` with an injected `request_id`.
   * - waits for exactly one matching response on `${topic}:result`.
   */
  request<TReq extends Record<string, unknown>, TRes>(
    topic: string,
    payload: TReq,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<TRes> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const request_id = crypto.randomUUID();
    const responseTopic = `${topic}:result`;

    return new Promise<TRes>((resolve, reject) => {
      let done = false;

      const cleanup = (dispose: () => void, timer?: ReturnType<typeof setTimeout>) => {
        if (done) return;
        done = true;
        dispose();
        if (timer) clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        cleanup(() => disposable.dispose());
        reject(new Error("request timeout"));
      }, timeoutMs);

      const disposable = this.subscribe<BusResultEnvelope<TRes>>(
        responseTopic,
        msg => {
          if (msg && msg.request_id === request_id) {
            cleanup(() => disposable.dispose(), timer);
            resolve(msg.data);
          }
        },
        { signal: opts.signal }
      );

      if (opts.signal) {
        if (opts.signal.aborted) {
          cleanup(() => disposable.dispose(), timer);
          reject(new Error("request aborted"));
          return;
        }
        opts.signal.addEventListener(
          "abort",
          () => {
            cleanup(() => disposable.dispose(), timer);
            reject(new Error("request aborted"));
          },
          { once: true }
        );
      }

      this.publish(topic, { ...payload, request_id } as TReq & { request_id: string });
    });
  }
}

export class TrajectoryApi {
  /** Initialise/replace the current trajectory snapshot for an entity. */
  static readonly TOPIC_INIT = "tangram:trajectory:init";
  /** Append new points to an entity trajectory (append-only log). */
  static readonly TOPIC_APPEND = "tangram:trajectory:append";
  /** Request a trajectory snapshot for an entity. */
  static readonly TOPIC_GET = "tangram:trajectory:get";

  private byKey = new Map<string, ShallowRef<unknown[]>>();
  private bus: BusApi;

  constructor(bus: BusApi) {
    this.bus = bus;

    this.bus.subscribe<TrajectoryInitPayload>(TrajectoryApi.TOPIC_INIT, p => {
      const ref = this.get(p.key);
      ref.value = Array.isArray(p.points) ? [...p.points] : [];
    });

    this.bus.subscribe<TrajectoryAppendPayload>(TrajectoryApi.TOPIC_APPEND, p => {
      const ref = this.get(p.key);
      const next = Array.isArray(p.points) ? p.points : [];
      if (next.length === 0) return;
      ref.value = [...ref.value, ...next];
    });
  }

  private keyToString(key: EntityKey): string {
    return `${key.type}:${key.id}`;
  }

  /**
   * Returns a reactive snapshot of the trajectory for a given entity.
   * The array is replaced on updates (append-only).
   *
   * Assumptions:
   * - Append-only log: providers only ever append points for a given `EntityKey`.
   * - Stable point schema: the structure of each point is producer-defined, but
   *   must remain stable for consumers. If it needs to change, publish to a new
   *   topic/version.
   * - Consumers should treat the returned array as immutable snapshots.
   */
  get(key: EntityKey): ShallowRef<unknown[]> {
    const k = this.keyToString(key);
    let r = this.byKey.get(k);
    if (!r) {
      r = shallowRef<unknown[]>([]);
      this.byKey.set(k, r);
    }
    return r;
  }
}

export class SelectionApi {
  static readonly TOPIC_CHANGED = "tangram:selection:changed";

  private _map = shallowRef<SelectionMap>(new Map());

  public get map(): SelectionMap {
    return this._map.value;
  }

  // for immutability
  private cloneMap(
    source: SelectionMap | Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const next = new Map<string, Set<string>>();
    for (const [k, v] of source) {
      next.set(k, new Set(v));
    }
    return next;
  }

  private areMapsEqual(a: SelectionMap, b: SelectionMap): boolean {
    if (a.size !== b.size) return false;
    for (const [type, idsA] of a) {
      const idsB = b.get(type);
      if (!idsB || idsB.size !== idsA.size) return false;
      for (const id of idsA) {
        if (!idsB.has(id)) return false;
      }
    }
    return true;
  }

  private update(
    next: Map<string, Set<string>>,
    opts: { publish?: boolean } = {}
  ): boolean {
    if (this.areMapsEqual(this._map.value, next)) return false;

    this._map.value = next;
    if (opts.publish) {
      this.publish();
    }
    return true;
  }

  constructor(private bus: BusApi) {
    // keep the internal store in sync with the bus.
    // (allows selection to be driven externally, if needed.)
    this.bus.subscribe<SelectionChangedPayload>(SelectionApi.TOPIC_CHANGED, payload => {
      if (payload?.selection instanceof Map) {
        this.update(payload.selection as Map<string, Set<string>>, { publish: false });
      }
    });
    this.publish(); // initial baseline so early subscribers never see `undefined`
  }

  /**
   * Subscribe to selection changes.
   *
   * The handler is invoked immediately with the current selection.
   */
  onChanged(handler: (selection: SelectionMap) => void): Disposable {
    handler(this._map.value);
    return this.bus.subscribe<SelectionChangedPayload>(
      SelectionApi.TOPIC_CHANGED,
      payload => {
        handler(payload.selection);
      }
    );
  }

  private publish(): void {
    this.bus.publish<SelectionChangedPayload>(SelectionApi.TOPIC_CHANGED, {
      selection: this._map.value
    });
  }

  has(key: EntityKey): boolean {
    return this._map.value.get(key.type)?.has(key.id) ?? false;
  }

  selectEntity(entity: Entity, exclusive: boolean = true): void {
    this.select({ id: entity.id, type: entity.type }, exclusive);
  }

  select(key: EntityKey, exclusive: boolean = true): void {
    const next = exclusive
      ? new Map<string, Set<string>>()
      : this.cloneMap(this._map.value);

    let set = next.get(key.type);
    if (!set) {
      set = new Set();
      next.set(key.type, set);
    }
    set.add(key.id);

    this.update(next, { publish: true });
  }

  deselect(key: EntityKey): void {
    const next = this.cloneMap(this._map.value);
    const set = next.get(key.type);
    if (set) {
      set.delete(key.id);
      if (set.size === 0) {
        next.delete(key.type);
      }
      this.update(next, { publish: true });
    }
  }

  clearType(type: string): void {
    if (!this._map.value.has(type)) return;
    const next = this.cloneMap(this._map.value);
    next.delete(type);
    this.update(next, { publish: true });
  }

  clear(): void {
    this.update(new Map(), { publish: true });
  }
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
  pluginId?: string;
  priority?: number;
  title?: string;
  relevantFor?: string | string[];
  visible?: boolean | (() => boolean);
}

export interface WidgetEntry extends WidgetOptions {
  id: string;
  pluginId?: string;
  priority: number;
  isCollapsed: boolean;
}

export interface EntityTypeOptions {
  pluginId?: string;
}

export interface EntityTypeDefinition {
  readonly type: string;
  readonly pluginId?: string;
}

export interface EntityTypeHandle extends Disposable {
  readonly type: string;
}

export interface MapLayerOptions {
  pluginId?: string;
  slot?: MapLayerSlot;
}

/**
 * Layers are rendered from bottom to top in the exact order of this array.
 * By mapping layers to semantic slots rather than numeric z-indexes, we
 * guarantee deterministic rendering regardless of network latency or plugin
 * installation order.
 */
export const MAP_LAYER_STACK = [
  "background", // e.g. weather radar, satellite imagery, static terrain polygons
  "analysis", // e.g. heatmaps, hexbins, airspace sector boundaries
  "routes", // flight plans / voyage routes
  "live_trails", // breadcrumbs behind live entities
  "tracks", // trajectory loaded from storage (e.g. Parquet)
  "entities_underlay", // e.g. ship hulls, selection halos
  "entities", // e.g. aircraft, ships, vehicles
  "highlights", // selection
  "ui_overlay", // ephemeral ui elements, tooltips
  "misc" // fallback (default)
] as const;

export type MapLayerSlot = (typeof MAP_LAYER_STACK)[number];

const DEFAULT_MAP_LAYER_OPTIONS: Required<MapLayerOptions> = {
  pluginId: "",
  slot: "misc"
};

function createMapLayerBuckets(): Record<MapLayerSlot, Map<string, Layer>> {
  return {
    background: new Map(),
    analysis: new Map(),
    routes: new Map(),
    live_trails: new Map(),
    tracks: new Map(),
    entities_underlay: new Map(),
    entities: new Map(),
    highlights: new Map(),
    ui_overlay: new Map(),
    misc: new Map()
  };
}

function normalizeMapLayerOptions(
  options?: MapLayerOptions,
  base: Required<MapLayerOptions> = DEFAULT_MAP_LAYER_OPTIONS
): Required<MapLayerOptions> {
  return {
    pluginId: options?.pluginId ?? base.pluginId,
    slot: options?.slot ?? base.slot
  };
}

export class UiApi {
  private app: App;
  readonly widgets = reactive<Record<WidgetLocation, WidgetEntry[]>>({
    TopBar: [],
    SideBar: [],
    MapOverlay: []
  });
  private settingsWidgets = new Map<string, Component>();

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
    const { priority = 0, title, relevantFor, visible } = options;
    const effectivePriority = location === "MapOverlay" ? 0 : priority;

    const widget: WidgetEntry = {
      id,
      pluginId: options.pluginId,
      priority: effectivePriority,
      title,
      relevantFor,
      visible,
      isCollapsed: false
    };

    this.widgets[location].push(widget);
    this.sortWidgets(location);

    return bindDisposableToCurrentScope(
      createDisposable(() => {
        const locationWidgets = this.widgets[location];
        const index = locationWidgets.findIndex(w => w.id === id);
        if (index > -1) {
          locationWidgets.splice(index, 1);
        }
      })
    );
  }

  public sortWidgets(location: WidgetLocation) {
    this.widgets[location].sort((a, b) => b.priority - a.priority);
  }

  removeAllByPlugin(pluginId: string): void {
    for (const location of Object.keys(this.widgets) as WidgetLocation[]) {
      const locationWidgets = this.widgets[location];
      for (let index = locationWidgets.length - 1; index >= 0; index -= 1) {
        if (locationWidgets[index]?.pluginId === pluginId) {
          locationWidgets.splice(index, 1);
        }
      }
    }
  }

  registerSettingsWidget(name: string, component: Component) {
    this.settingsWidgets.set(name, component);
    if (getCurrentScope()) {
      onScopeDispose(() => {
        if (this.settingsWidgets.get(name) === component) {
          this.settingsWidgets.delete(name);
        }
      });
    }
  }

  getSettingsWidget(name: string): Component | undefined {
    return this.settingsWidgets.get(name);
  }
}
// NOTE: we use arrow functions to capture lexical `this` properly.

export class MapApi implements Disposable {
  private tangramApi: TangramApi;
  private overlay: MapboxOverlay | null = null;
  private readonly layerSlots = createMapLayerBuckets();
  private readonly layerSlotById = new Map<string, MapLayerSlot>();
  private readonly layerPluginIdById = new Map<string, string>();

  constructor(tangramApi: TangramApi) {
    this.tangramApi = tangramApi;
  }

  readonly map = shallowRef<MaplibreMap | null>(null);
  readonly isReady = computed(() => !!this.map.value);

  readonly center = ref({ lng: 0, lat: 0 });
  readonly zoom = ref(0);
  readonly pitch = ref(0);
  readonly bearing = ref(0);
  readonly bounds: Ref<Readonly<LngLatBounds> | null> = ref(null);
  readonly mapLayerVisibility = reactive<Record<string, boolean>>({});

  readonly styleJson = shallowRef<StyleSpecification | null>(null);

  private updateState = () => {
    if (!this.map.value) return;
    const map = this.map.value;
    const c = map.getCenter();
    this.center.value = {
      lng: parseFloat(c.lng.toFixed(5)),
      lat: parseFloat(c.lat.toFixed(5))
    };
    this.zoom.value = parseFloat(map.getZoom().toFixed(2));
    this.pitch.value = parseFloat(map.getPitch().toFixed(2));
    this.bearing.value = parseFloat(map.getBearing().toFixed(2));
    (this.bounds as Ref).value = map.getBounds();
  };

  initialize = (mapInstance: MaplibreMap) => {
    this.map.value = mapInstance;
    this.overlay = new MapboxOverlay({
      interleaved: false,
      onHover: info => {
        const canvas = this.map.value?.getCanvas();
        if (canvas) {
          canvas.style.cursor = info.object ? "pointer" : "";
        }
      },
      onClick: info => {
        if (!info.object) {
          this.tangramApi.selection.clear();
        }
      }
    });
    this.map.value.addControl(this.overlay);
    this.syncDeckLayers();

    const onMapLoad = () => {
      this.updateState();
      this.map.value?.off("load", onMapLoad);
      this.syncLayerState();
    };
    this.map.value.on("load", onMapLoad);
    this.map.value.on("styledata", this.syncLayerState);

    this.map.value.on("moveend", this.updateState);
    this.map.value.on("zoomend", this.updateState);
    this.map.value.on("pitchend", this.updateState);
    this.map.value.on("rotateend", this.updateState);
  };

  private syncLayerState = () => {
    const map = this.map.value;
    if (!map) return;
    const style = map.getStyle();
    if (!style) return;
    this.styleJson.value = style;
    for (const l of style.layers) {
      if (this.mapLayerVisibility[l.id] === undefined) {
        this.mapLayerVisibility[l.id] = l.layout?.visibility !== "none";
      }
    }
  };

  setMapLayerVisibility(id: string, visible: boolean) {
    this.map.value?.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    this.mapLayerVisibility[id] = visible;
  }

  dispose = () => {
    this.map.value?.remove();
    this.map.value = null;
    this.overlay = null;
  };

  getMapInstance = (): MaplibreMap => {
    if (!this.map.value) {
      throw new Error("map not initialized");
    }
    return this.map.value;
  };

  private removeLayerEntry(layerId: string) {
    const slot = this.layerSlotById.get(layerId);
    if (!slot) return;
    this.layerSlots[slot].delete(layerId);
    this.layerSlotById.delete(layerId);
    this.layerPluginIdById.delete(layerId);
    this.syncDeckLayers();
  }

  private upsertLayer(layer: Layer, options: Required<MapLayerOptions>) {
    const slot = options.slot;
    const previousSlot = this.layerSlotById.get(layer.id);
    if (previousSlot && previousSlot !== slot) {
      this.layerSlots[previousSlot].delete(layer.id);
    }

    this.layerSlots[slot].set(layer.id, layer);
    this.layerSlotById.set(layer.id, slot);

    if (options.pluginId) {
      this.layerPluginIdById.set(layer.id, options.pluginId);
    } else {
      this.layerPluginIdById.delete(layer.id);
    }
  }

  private syncDeckLayers() {
    const layers: Layer[] = [];
    for (const slot of MAP_LAYER_STACK) {
      for (const layer of this.layerSlots[slot].values()) {
        layers.push(layer);
      }
    }

    this.overlay?.setProps({ layers });
  }

  refreshLayerOrder() {
    this.syncDeckLayers();
  }

  removeAllByPlugin(pluginId: string): void {
    let changed = false;

    for (const [layerId, ownerId] of this.layerPluginIdById.entries()) {
      if (ownerId !== pluginId) continue;

      const slot = this.layerSlotById.get(layerId);
      if (!slot) continue;

      this.layerSlots[slot].delete(layerId);
      this.layerSlotById.delete(layerId);
      this.layerPluginIdById.delete(layerId);
      changed = true;
    }

    if (changed) {
      this.syncDeckLayers();
    }
  }

  /**
   * Adds a layer to the map pipeline.
   *
   * If called from a plugin's root `install()` function, provide
   * `pluginId: ctx.id` for automatic cleanup. If called dynamically from inside
   * a Vue component (e.g. clicking a button to highlight an airspace), capture
   * the returned `Disposable` and call `.dispose()` inside Vue's `onUnmounted.
   */
  addLayer(layer: Layer, options?: MapLayerOptions): Disposable {
    this.upsertLayer(layer, normalizeMapLayerOptions(options));
    this.syncDeckLayers();
    return createDisposable(() => this.removeLayerEntry(layer.id));
  }

  setLayer(layer: Layer, options?: MapLayerOptions): Disposable {
    this.upsertLayer(
      layer,
      normalizeMapLayerOptions(options, {
        pluginId:
          options?.pluginId ??
          this.layerPluginIdById.get(layer.id) ??
          DEFAULT_MAP_LAYER_OPTIONS.pluginId,
        slot: this.layerSlotById.get(layer.id) ?? DEFAULT_MAP_LAYER_OPTIONS.slot
      })
    );
    this.syncDeckLayers();
    return createDisposable(() => this.removeLayerEntry(layer.id));
  }
}

// TODO: in the future, entities may simply mean rows in a arrow table (e.g. from a parquet file)
// NOTE: the server may return entities within the map bounding box
// so the entities stored may not represent the full set of entities
// we thus do not provide a "total entity count" in this api.
export class StateApi {
  readonly entitiesByType: Map<string, ShallowRef<Map<EntityId, Entity>>> = new Map();
  readonly totalCounts: Ref<ReadonlyMap<string, number>> = ref(new Map());
  readonly entityTypes: ShallowRef<ReadonlyMap<string, EntityTypeDefinition>> =
    shallowRef(new Map());

  constructor(private selection: SelectionApi) {}

  private ensureEntityBucket(type: string): ShallowRef<Map<EntityId, Entity>> {
    let bucket = this.entitiesByType.get(type);
    if (!bucket) {
      bucket = shallowRef(new Map());
      this.entitiesByType.set(type, bucket);
    }
    return bucket;
  }

  private deleteEntityType(type: string): void {
    if (!this.entityTypes.value.has(type)) return;
    const nextMap = new Map(this.entityTypes.value);
    nextMap.delete(type);
    this.entityTypes.value = nextMap;
  }

  registerEntityType = (
    type: string,
    options: EntityTypeOptions = {}
  ): EntityTypeHandle => {
    this.ensureEntityBucket(type);
    const nextMap = new Map(this.entityTypes.value);
    nextMap.set(type, {
      type,
      pluginId: options.pluginId
    });
    this.entityTypes.value = nextMap;

    return bindDisposableToCurrentScope({
      type,
      ...createDisposable(() => {
        this.unregisterEntityType(type);
      })
    });
  };

  unregisterEntityType = (type: string): void => {
    this.selection.clearType(type);

    const bucket = this.entitiesByType.get(type);
    if (bucket) {
      bucket.value = new Map();
    }
    this.entitiesByType.delete(type);

    if (this.totalCounts.value.has(type)) {
      const nextTotalCounts = new Map(this.totalCounts.value);
      nextTotalCounts.delete(type);
      this.totalCounts.value = nextTotalCounts;
    }

    this.deleteEntityType(type);
  };

  removeAllByPlugin(pluginId: string): void {
    const ownedTypes = Array.from(this.entityTypes.value.values())
      .filter(definition => definition.pluginId === pluginId)
      .map(definition => definition.type);

    for (const type of ownedTypes) {
      this.unregisterEntityType(type);
    }
  }

  getEntityType = (type: string): EntityTypeDefinition | undefined => {
    return this.entityTypes.value.get(type);
  };

  getEntitiesByType = <T extends EntityState>(
    type: string
  ): Ref<ReadonlyMap<EntityId, Entity<T>>> => {
    return this.ensureEntityBucket(type) as Ref<ReadonlyMap<EntityId, Entity<T>>>;
  };

  getEntity = <T extends EntityState>(key: EntityKey): Entity<T> | undefined => {
    return this.getEntitiesByType<T>(key.type).value.get(key.id) as
      | Entity<T>
      | undefined;
  };

  setEntity = <T extends EntityState>(entity: Entity<T>): void => {
    const bucket = this.ensureEntityBucket(entity.type);
    const nextMap = new Map(bucket.value);
    nextMap.set(entity.id, entity);
    bucket.value = nextMap;
  };

  removeEntity = (key: EntityKey): void => {
    const bucket = this.entitiesByType.get(key.type);
    if (!bucket || !bucket.value.has(key.id)) return;

    const nextMap = new Map(bucket.value);
    nextMap.delete(key.id);
    bucket.value = nextMap;
  };

  clearEntitiesByType = (type: string): void => {
    const bucket = this.entitiesByType.get(type);
    if (!bucket) return;
    bucket.value = new Map();
  };

  replaceAllEntitiesByType = (type: string, newEntities: Entity[]): void => {
    const bucket = this.ensureEntityBucket(type);

    const newMap = new Map<EntityId, Entity>();
    for (const entity of newEntities) {
      newMap.set(entity.id, entity);
    }
    bucket.value = newMap;
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
    const scopeController = new AbortController();
    if (getCurrentScope()) {
      onScopeDispose(() => scopeController.abort());
    }

    const [channelTopic, event] = this.parseTopicEvent(topic);
    const channel = await this.getChannel(channelTopic);

    if (scopeController.signal.aborted) {
      return createDisposable(() => {});
    }

    const ref = channel.on(event, callback);
    const disposable = createDisposable(() => {
      scopeController.abort();
      channel.off(event, ref);
    });

    scopeController.signal.addEventListener("abort", () => disposable.dispose(), {
      once: true
    });

    return disposable;
  }

  async publish<T extends Record<string, unknown>>(
    topic: string,
    payload: T
  ): Promise<void> {
    const [channelTopic, event] = this.parseTopicEvent(topic);
    const channel = await this.getChannel(channelTopic);
    channel.push(event, payload);
  }

  /**
   * Performs a request-response cycle over the websocket.
   */
  async request<TRes, TReq = unknown>(
    topic: string,
    payload: TReq,
    timeoutMs = 5000
  ): Promise<TRes> {
    const [channelTopic, event] = this.parseTopicEvent(topic);
    const channel = await this.getChannel(channelTopic);
    const responseEvent = `${event}_result`;
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("request timeout"));
      }, timeoutMs);

      const ref = channel.on(responseEvent, (msg: unknown) => {
        if (typeof msg !== "object" || msg === null) return;
        const record = msg as Record<string, unknown>;
        if (typeof record.request_id !== "string") return;
        if (record.request_id === requestId) {
          cleanup();
          resolve(record.data as TRes);
        }
      });

      const cleanup = () => {
        clearTimeout(timer);
        channel.off(responseEvent, ref);
      };

      channel.push(event, { ...payload, request_id: requestId });
    });
  }
}

export interface SearchResult {
  id: string;
  score?: number;
  component: Component;
  props?: Record<string, unknown>;
  onSelect?: () => void;
  children?: SearchResult[];
}

export interface SearchProvider {
  id: string;
  pluginId?: string;
  name: string;
  search: (query: string, signal: AbortSignal) => Promise<SearchResult[]>;
}

export class SearchApi {
  private providers = new Map<string, SearchProvider>();

  registerProvider(provider: SearchProvider): Disposable {
    this.providers.set(provider.id, provider);
    return bindDisposableToCurrentScope(
      createDisposable(() => {
        this.providers.delete(provider.id);
      })
    );
  }

  removeAllByPlugin(pluginId: string): void {
    for (const [providerId, provider] of this.providers.entries()) {
      if (provider.pluginId === pluginId) {
        this.providers.delete(providerId);
      }
    }
  }

  async search(
    query: string,
    signal: AbortSignal,
    onResult: (results: SearchResult[]) => void
  ): Promise<void> {
    await Promise.all(
      Array.from(this.providers.values()).map(async provider => {
        try {
          const results = await provider.search(query, signal);
          if (!signal.aborted && results.length > 0) {
            onResult(results);
          }
        } catch (e) {
          if (!signal.aborted) {
            console.error(`search error in ${provider.id}:`, e);
          }
        }
      })
    );
  }
}

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  tangram_mutable?: boolean;
  tangram_widget?: string;
  tangram_kind?: string;
  [key: string]: unknown;
};

export interface PluginSettings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: Record<string, any>;
  schema: JsonSchema;
  errors: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Manifest = any;

export class TangramApi {
  readonly time: TimeApi;
  readonly ui: UiApi;
  readonly map: MapApi;
  readonly state: StateApi;
  readonly bus: BusApi;
  readonly trajectory: TrajectoryApi;
  readonly selection: SelectionApi;
  readonly realtime: RealtimeApi;
  readonly search: SearchApi;
  readonly config: TangramConfig;
  // TODO: maybe its better to have plugins store their own reactive plugin settings...
  readonly settings = reactive<Record<string, PluginSettings>>({});
  readonly manifest: Manifest;
  readonly app: App;

  private constructor(app: App, config: TangramConfig, manifest: Manifest) {
    this.config = config;
    this.manifest = manifest;
    this.bus = new BusApi();
    this.realtime = new RealtimeApi(config);
    this.ui = new UiApi(app);
    this.time = new TimeApi();
    this.map = new MapApi(this);
    this.trajectory = new TrajectoryApi(this.bus);
    this.selection = new SelectionApi(this.bus);
    this.state = new StateApi(this.selection);
    this.search = new SearchApi();

    this.app = app;
    this.ui.registerSettingsWidget("map-settings", MapSettings);
    this.ui.registerSettingsWidget("theme-settings", ThemeSettings);

    this.applyTheme();
    this.setupViewUpdates();
    this.setupSettingsWatchers();
  }

  private applyTheme() {
    const active = this.config.core.theme;
    const definitionMap = new Map(this.config.core.themes.map(d => [d.name, d]));

    const render = (name: string) => {
      const theme = definitionMap.get(name);
      if (!theme) return;
      const root = document.documentElement;
      root.style.setProperty("--t-bg", theme.background);
      root.style.setProperty("--t-fg", theme.foreground);
      root.style.setProperty("--t-surface", theme.surface);
      root.style.setProperty("--t-border", theme.border);
      root.style.setProperty("--t-hover", theme.hover);
      root.style.setProperty("--t-accent1", theme.accent1);
      root.style.setProperty("--t-accent1-fg", theme.accent1_foreground);
      root.style.setProperty("--t-accent2", theme.accent2);
      root.style.setProperty("--t-accent2-fg", theme.accent2_foreground);
      root.style.setProperty("--t-muted", theme.muted);
      root.style.setProperty("--t-error", theme.error);
    };

    if (typeof active === "string") {
      render(active);
    } else {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const update = () => render(media.matches ? active.dark : active.light);
      update();
      media.addEventListener("change", update);
    }
  }

  private setupSettingsWatchers() {
    watch(
      () => this.settings.tangram_core?.values,
      newValues => {
        if (!newValues) return;

        const core = newValues.core as CoreConfig | undefined;
        const mapVals = newValues.map as MapConfig | undefined;

        if (core) {
          if (core.theme) this.config.core.theme = core.theme;
          if (core.themes) this.config.core.themes = core.themes;
          this.applyTheme();
        }

        const map = this.map.map.value;
        if (map && mapVals) {
          if (mapVals.style && mapVals.style !== this.config.map.style) {
            this.config.map.style = mapVals.style;
            map.setStyle(mapVals.style);
          }
          if (
            mapVals.zoom !== undefined &&
            Math.abs(map.getZoom() - mapVals.zoom) > 0.01
          )
            map.setZoom(mapVals.zoom);
          if (
            mapVals.pitch !== undefined &&
            Math.abs(map.getPitch() - mapVals.pitch) > 0.01
          )
            map.setPitch(mapVals.pitch);
          if (
            mapVals.bearing !== undefined &&
            Math.abs(map.getBearing() - mapVals.bearing) > 0.01
          )
            map.setBearing(mapVals.bearing);
          if (mapVals.min_zoom !== undefined) map.setMinZoom(mapVals.min_zoom);
          if (mapVals.max_zoom !== undefined) map.setMaxZoom(mapVals.max_zoom);
          if (mapVals.max_pitch !== undefined) map.setMaxPitch(mapVals.max_pitch);
          if (mapVals.allow_pitch !== undefined) {
            if (mapVals.allow_pitch) map.dragRotate.enable();
            else map.dragRotate.disable();
          }

          Object.assign(this.config.map, {
            zoom: mapVals.zoom,
            pitch: mapVals.pitch,
            bearing: mapVals.bearing,
            min_zoom: mapVals.min_zoom,
            max_zoom: mapVals.max_zoom,
            max_pitch: mapVals.max_pitch,
            allow_pitch: mapVals.allow_pitch,
            allow_bearing: mapVals.allow_bearing
          });
        }
      },
      { deep: true }
    );

    watch(
      () => this.map.center.value,
      newCenter => {
        if (this.settings.tangram_core && this.settings.tangram_core.values.map) {
          this.settings.tangram_core.values.map.center_lat = newCenter.lat;
          this.settings.tangram_core.values.map.center_lon = newCenter.lng;
        }
      }
    );
    watch(
      () => this.map.zoom.value,
      v => {
        if (this.settings.tangram_core && this.settings.tangram_core.values.map)
          this.settings.tangram_core.values.map.zoom = v;
      }
    );
    watch(
      () => this.map.pitch.value,
      v => {
        if (this.settings.tangram_core && this.settings.tangram_core.values.map)
          this.settings.tangram_core.values.map.pitch = v;
      }
    );
    watch(
      () => this.map.bearing.value,
      v => {
        if (this.settings.tangram_core && this.settings.tangram_core.values.map)
          this.settings.tangram_core.values.map.bearing = v;
      }
    );

    watch(
      () => this.settings,
      () => {
        for (const [pName, pSettings] of Object.entries(this.settings)) {
          const tOrder = pSettings.values.topbar_order;
          const sOrder = pSettings.values.sidebar_order;

          if (tOrder !== undefined || sOrder !== undefined) {
            const pluginSuffix = pName.startsWith("tangram_") ? pName.slice(8) : pName;

            const applyOrder = (
              location: "TopBar" | "SideBar",
              order: number | undefined
            ) => {
              if (order === undefined) return;
              const widgets = this.ui.widgets[location];
              for (const w of widgets) {
                if (w.pluginId === pName || w.id.includes(pluginSuffix)) {
                  w.priority = order;
                }
              }
              this.ui.sortWidgets(location);
            };

            applyOrder("TopBar", tOrder);
            applyOrder("SideBar", sOrder);
          }
        }
      },
      { deep: true }
    );
  }

  private setupViewUpdates() {
    const updateView = () => {
      const connId = this.realtime.getConnectionId();
      if (!connId) return;
      const bounds = this.map.bounds.value;
      if (!bounds) return;

      const selectedEntities: { id: string; typeName: string }[] = [];
      for (const [type, ids] of this.selection.map) {
        for (const id of ids) {
          selectedEntities.push({ id, typeName: type });
        }
      }

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
    watch(() => this.selection.map, updateView, { deep: true });
  }

  public static async create(app: App): Promise<TangramApi> {
    const manifest = await fetch("/manifest.json").then(res => res.json());
    const core = manifest.core;
    if (!core) throw new Error("core configuration missing in manifest");

    const config: TangramConfig = core.config;

    const api = new TangramApi(app, config, manifest);

    api.settings["tangram_core"] = {
      values: reactive({ ...config }),
      schema: core.config_json_schema || {},
      errors: reactive({})
    };

    return api;
  }

  getVueApp(): App {
    return this.app;
  }

  /**
   * Performs a cleanup of all passive data registered by a plugin.
   *
   * Tangram strictly separates data from resources.
   * We do not force developers to hold arrays of `Disposable` callbacks for UI
   * elements or map layers. Inspired by cascading deletes in a SQL database.
   */
  teardownPlugin(pluginId: string): void {
    this.map.removeAllByPlugin(pluginId);
    this.ui.removeAllByPlugin(pluginId);
    this.state.removeAllByPlugin(pluginId);
    this.search.removeAllByPlugin(pluginId);
  }
}

/**
 * Explicit plugin-scoped context passed to every plugin install() function.
 *
 * NOTE: Why pass context explicitly instead of using a global proxy?
 * Browser JavaScript is single-threaded and lacks native async local storage.
 * Because tangram loads plugins concurrently, relying on a global
 * "currentPlugin" variable across await boundaries causes race conditions.
 *
 * - passive data (widgets, layers, EntityTypes): pass `pluginId: ctx.id`.
 *   core will bulk-sweep from registries on plugin unload.
 * - active resources (WebSockets, Timers, DOM Listeners): wrap in `ctx.onDispose`.
 */
export interface PluginContext {
  readonly id: string;
  readonly api: TangramApi;
  onDispose<T extends Disposable>(disposable: T): T;
}
