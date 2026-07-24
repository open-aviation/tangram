// Loads traffic.js lazily from a CDN and exposes a memoized, multi-source
// navigation Resolver plus navaid/fix prefix search.
//
// traffic.js (https://github.com/xoolive/traffic.js) ships the same navigation
// data sources as the planned-route-encoding.qmd interactive page: X-Plane
// navdata (default global source), EUROCONTROL DDR (primary route source),
// FAA ArcGIS (optional). It is a 31 MB package with heavy runtime deps, so it
// is dynamically imported from a CDN on first use and never bundled.

// --- structural types for the traffic.js data API we consume --------------
// traffic.js is not a build-time dependency, so we model only the surface we
// call. Keep these loose: traffic.js may attach extra fields we ignore.

export interface NavFeatureProperties {
  ident: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_ft?: number;
  frequency?: number;
  range_nm?: number;
  variation?: number;
  type?: number;
  kind: string;
  source?: string;
}

export interface FixFeatureProperties {
  ident: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: "fix";
  source?: string;
}

export interface PointFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: P;
}

export interface LineStringFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    name: string | null;
    segment_type: string | null;
    connector: string | null;
    start_name: string | null;
    end_name: string | null;
    start_kind: string | null;
    end_kind: string | null;
  };
}

export interface FeatureCollection<F = PointFeature | LineStringFeature> {
  type: "FeatureCollection";
  features: F[];
}

export interface ResolveQuery {
  airport?: string;
  navaid?: string;
  fix?: string;
  airway?: string;
  SID?: string;
  STAR?: string;
  near?: unknown;
  source?: string | string[];
}

type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

interface EarthResolver {
  navaids?: { data: () => Promise<PointFeature<NavFeatureProperties>[]> };
  fixes?: { data: () => Promise<PointFeature<FixFeatureProperties>[]> };
  airways?: { data: () => Promise<unknown[]> };
  resolve(query: ResolveQuery): Promise<PointFeature | null>;
  enrichRoute(route: string): [];
}

interface DdrResolver {
  resolve(query: ResolveQuery): Promise<unknown>;
  enrichRoute(route: string): unknown;
}

interface FaaResolver {
  preloadAll?(): Promise<void>;
  resolve(query: ResolveQuery): Promise<unknown>;
  enrichRoute?(route: string): unknown;
}

interface LookupSource {
  navaids?: { data: () => Promise<unknown[]> };
  fixes?: { data: () => Promise<unknown[]> };
  airways?: { data: () => Promise<unknown[]> };
  resolve?(query: ResolveQuery): unknown | Promise<unknown>;
  enrichRoute?(route: string): unknown;
}

interface ResolverInstance {
  withSource(name: string, source: LookupSource): this;
  withDdr(ddr: DdrResolver): this;
  withArcgis(arcgis: FaaResolver): this;
  enrichRouteAsGeoJSON(route: string): Promise<FeatureCollection<LineStringFeature>>;
  extractRoutePointsAsGeoJSON(
    route: { features?: LineStringFeature[] },
    options?: { dedupe?: boolean }
  ): FeatureCollection<PointFeature<{ ident: string; kind: string | null }>>;
}

interface TrafficDataApi {
  Resolver: new () => ResolverInstance;
  xplane: {
    createEarthNavResolver: (options?: { fetchFn?: FetchFn }) => Promise<EarthResolver>;
    createEarthFixResolver: (options?: { fetchFn?: FetchFn }) => Promise<EarthResolver>;
    createEarthAwyResolver: (options?: { fetchFn?: FetchFn }) => Promise<EarthResolver>;
  };
  eurocontrol: {
    createEurocontrolDdrResolver: (options: {
      archiveUrl: string;
    }) => Promise<DdrResolver>;
  };
  faa: {
    createFaaArcgisResolver: (options?: { eager?: boolean }) => Promise<FaaResolver>;
  };
}

interface TrafficEnvApi {
  setThrustWasm: (config: { thrustModuleUrl?: string; thrustModule?: unknown }) => void;
}

interface TrafficLib {
  data: TrafficDataApi;
  env: TrafficEnvApi;
}

export interface RouteResolution {
  route: FeatureCollection<LineStringFeature>;
  points: FeatureCollection<PointFeature<{ ident: string; kind: string | null }>>;
}

// --- configuration ---------------------------------------------------------

const DEFAULT_TRAFFIC_JS_URL = "https://esm.sh/traffic.js@0.2.0";
const DDR_ARCHIVE_URL = "/navaid/ddr";

let configuredTrafficUrl: string | undefined;
let enableFaa = false;

export function configureTraffic(opts: {
  trafficJsUrl?: string | null;
  enableFaa?: boolean;
}): void {
  const trafficUrl = opts.trafficJsUrl?.trim() || undefined;
  const faa = opts.enableFaa ?? false;
  if (trafficUrl === configuredTrafficUrl && faa === enableFaa) return;

  configuredTrafficUrl = trafficUrl;
  enableFaa = faa;
  trafficPromise = null;
  xplanePromise = null;
  resolverPromise = null;
  navIndexPromise = null;
  fixIndexPromise = null;
}

// --- thrust-wasm module (bundled as a plugin asset, handed to traffic.js) ---
//
// traffic.js needs thrust-wasm for parseField15 and EUROCONTROL DDR route
// enrichment. Its built-in CDN auto-load fails through the esm.sh shim, so the
// plugin ships the web loader + .wasm locally (see vite.config.ts) and passes
// the loaded module to traffic.js via setThrustWasm({ thrustModule }).
let thrustModule: unknown = null;

export function setThrustModule(mod: unknown): void {
  thrustModule = mod;
}

// --- traffic.js loader -----------------------------------------------------

let trafficPromise: Promise<TrafficLib> | null = null;

function loadTraffic(): Promise<TrafficLib> {
  const url = configuredTrafficUrl ?? DEFAULT_TRAFFIC_JS_URL;
  if (!trafficPromise) {
    trafficPromise = import(/* @vite-ignore */ url)
      .then((mod: TrafficLib & { default?: unknown }) => {
        if (mod?.data && mod?.env) return mod;
        const def = mod?.default as TrafficLib | undefined;
        if (def?.data && def?.env) return def;
        throw new Error(
          "traffic.js loaded from CDN but its data/env namespaces are missing"
        );
      })
      .catch(err => {
        trafficPromise = null; // allow a retry on the next search
        throw err;
      });
  }
  return trafficPromise;
}

// --- X-Plane sources and route resolver ------------------------------------

interface XplaneSources {
  nav: EarthResolver;
  fix: EarthResolver;
  source: LookupSource;
}

let xplanePromise: Promise<XplaneSources> | null = null;
let resolverPromise: Promise<ResolverInstance> | null = null;

function getXplaneSources(): Promise<XplaneSources> {
  if (!xplanePromise) {
    xplanePromise = buildXplaneSources().catch(err => {
      xplanePromise = null;
      throw err;
    });
  }
  return xplanePromise;
}

async function buildXplaneSources(): Promise<XplaneSources> {
  const lib = await loadTraffic();

  // TODO: deprecate this adapter when traffic.js and the xplane datasets are
  // bundled as plugin assets. until then, force reuse of githubusercontent data
  const fetchFn: FetchFn = url => fetch(url, { cache: "force-cache" });
  const [nav, fix, awy] = await Promise.all([
    lib.data.xplane.createEarthNavResolver({ fetchFn }),
    lib.data.xplane.createEarthFixResolver({ fetchFn }),
    lib.data.xplane.createEarthAwyResolver({ fetchFn })
  ]);

  return {
    nav,
    fix,
    source: {
      navaids: nav.navaids,
      fixes: fix.fixes,
      airways: awy.airways,
      resolve: async (query: ResolveQuery) => {
        if (query.airway) return awy.resolve(query);
        if (query.navaid) {
          return (
            (await nav.resolve({ navaid: query.navaid, near: query.near })) ??
            fix.resolve({ fix: query.navaid })
          );
        }
        if (query.fix) {
          return (
            (await fix.resolve({ fix: query.fix })) ??
            nav.resolve({ navaid: query.fix })
          );
        }
        return null;
      },
      enrichRoute: () => []
    }
  };
}

function getResolver(): Promise<ResolverInstance> {
  if (!resolverPromise) {
    resolverPromise = buildResolver().catch(err => {
      resolverPromise = null;
      throw err;
    });
  }
  return resolverPromise;
}

async function buildResolver(): Promise<ResolverInstance> {
  const [lib, xplane] = await Promise.all([loadTraffic(), getXplaneSources()]);
  if (thrustModule) lib.env.setThrustWasm({ thrustModule });

  const resolver = new lib.data.Resolver().withSource("xplane", xplane.source);
  const ddr = await lib.data.eurocontrol.createEurocontrolDdrResolver({
    archiveUrl: DDR_ARCHIVE_URL
  });
  resolver.withDdr(ddr);

  if (enableFaa) {
    const faa = await lib.data.faa.createFaaArcgisResolver();
    await faa.preloadAll?.();
    resolver.withArcgis(faa);
  }

  return resolver;
}

// --- navaid / fix prefix search index (built once, cached) ----------------

type AnyNavFeature = PointFeature<NavFeatureProperties>;
type AnyFixFeature = PointFeature<FixFeatureProperties>;

let navIndexPromise: Promise<Map<string, AnyNavFeature[]>> | null = null;
let fixIndexPromise: Promise<Map<string, AnyFixFeature[]>> | null = null;

async function buildNavIndex(): Promise<Map<string, AnyNavFeature[]>> {
  if (!navIndexPromise) {
    navIndexPromise = (async () => {
      const { nav } = await getXplaneSources();
      const features = (await nav.navaids?.data()) ?? [];
      return indexByIdent(features);
    })();
  }
  return navIndexPromise;
}

async function buildFixIndex(): Promise<Map<string, AnyFixFeature[]>> {
  if (!fixIndexPromise) {
    fixIndexPromise = (async () => {
      const { fix } = await getXplaneSources();
      const features = (await fix.fixes?.data()) ?? [];
      return indexByIdent(features);
    })();
  }
  return fixIndexPromise;
}

function indexByIdent<P extends { ident?: string }>(
  features: PointFeature<P>[]
): Map<string, PointFeature<P>[]> {
  const idx = new Map<string, PointFeature<P>[]>();
  for (const feature of features) {
    const ident = feature.properties?.ident?.toUpperCase();
    if (!ident) continue;
    const bucket = idx.get(ident);
    if (bucket) bucket.push(feature);
    else idx.set(ident, [feature]);
  }
  return idx;
}

/**
 * Rank collection matches: exact ident first, then ident prefix, then name
 * substring. One row per ident (the first occurrence). This mirrors what a
 * pilot expects from a navaid/fix designator search.
 */
function rankFromIndex<P extends { ident?: string; name?: string }>(
  index: Map<string, PointFeature<P>[]>,
  query: string,
  limit: number
): PointFeature<P>[] {
  const out: PointFeature<P>[] = [];
  const seen = new Set<string>();

  const exact = index.get(query);
  if (exact) {
    for (const feature of exact) {
      out.push(feature);
    }
    seen.add(query);
  }

  for (const [ident, features] of index) {
    if (seen.has(ident)) continue;
    if (ident.startsWith(query)) {
      out.push(features[0]);
      seen.add(ident);
    }
    if (out.length >= limit) return out.slice(0, limit);
  }

  for (const [ident, features] of index) {
    if (seen.has(ident)) continue;
    const name = features[0].properties?.name?.toUpperCase();
    if (name && name.includes(query)) {
      out.push(features[0]);
      seen.add(ident);
    }
    if (out.length >= limit) return out.slice(0, limit);
  }

  return out.slice(0, limit);
}

export async function searchNavaids(
  query: string,
  limit: number
): Promise<AnyNavFeature[]> {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const index = await buildNavIndex();
  return rankFromIndex(index, q, limit);
}

export async function searchFixes(
  query: string,
  limit: number
): Promise<AnyFixFeature[]> {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const index = await buildFixIndex();
  return rankFromIndex(index, q, limit);
}

// --- Field 15 route resolution --------------------------------------------

export async function resolveRoute(expression: string): Promise<RouteResolution> {
  const resolver = await getResolver();
  const route = await resolver.enrichRouteAsGeoJSON(expression);
  const points = resolver.extractRoutePointsAsGeoJSON(route);
  return { route, points };
}
