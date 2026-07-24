import type { Field15Element, LookupSource, ResolveQuery } from "traffic.js";

// Loads the bundled traffic.js runtime lazily and exposes a memoized,
// multi-source navigation resolver plus navaid/fix prefix search.

// --- structural types for the traffic.js data API we consume --------------

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

type TrafficLib = Pick<typeof import("traffic.js"), "data" | "env">;
type TrafficData = TrafficLib["data"];
type EarthNavResolver = Awaited<
  ReturnType<TrafficData["xplane"]["createEarthNavResolver"]>
>;
type EarthFixResolver = Awaited<
  ReturnType<TrafficData["xplane"]["createEarthFixResolver"]>
>;
type EarthAwyResolver = Awaited<
  ReturnType<TrafficData["xplane"]["createEarthAwyResolver"]>
>;
type ResolverInstance = InstanceType<TrafficData["Resolver"]>;
type XplaneSource = LookupSource & {
  navaids: EarthNavResolver["navaids"];
  fixes: EarthFixResolver["fixes"];
  airways: EarthAwyResolver["airways"];
};

export interface RouteResolution {
  route: FeatureCollection<LineStringFeature>;
  points: FeatureCollection<PointFeature<{ ident: string; kind: string | null }>>;
}

// --- configuration ---------------------------------------------------------

const DDR_ARCHIVE_URL = "/navaid/ddr";
const XPLANE_URLS = {
  nav: "/navaid/xplane/nav",
  fix: "/navaid/xplane/fix",
  awy: "/navaid/xplane/awy"
} as const;
const FAA_URLS = [
  "/navaid/faa/airports",
  "/navaid/faa/routes",
  "/navaid/faa/points",
  "/navaid/faa/navaids"
] as const;

let enableFaa = false;

export function configureTraffic(opts: { enableFaa?: boolean }): void {
  const faa = opts.enableFaa ?? false;
  if (faa === enableFaa) return;

  enableFaa = faa;
  resolverPromise = null;
}

// --- thrust-wasm module (bundled as a plugin asset, handed to traffic.js) ---
//
// traffic.js needs thrust-wasm for Field 15 parsing and DDR route enrichment.
// The plugin ships the web loader and wasm binary locally and passes the module
// to traffic.js before constructing the route resolver.
let thrustModule: unknown = null;

export function setThrustModule(mod: unknown): void {
  thrustModule = mod;
}

// --- traffic.js loader -----------------------------------------------------

let trafficPromise: Promise<TrafficLib> | null = null;

function loadTraffic(): Promise<TrafficLib> {
  if (!trafficPromise) {
    trafficPromise = import("traffic.js")
      .then(({ data, env }) => ({ data, env }))
      .catch(err => {
        trafficPromise = null;
        throw err;
      });
  }
  return trafficPromise;
}

// --- X-Plane sources and route resolver ------------------------------------

interface XplaneSources {
  nav: EarthNavResolver;
  fix: EarthFixResolver;
  source: XplaneSource;
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

  const [nav, fix, awy] = await Promise.all([
    lib.data.xplane.createEarthNavResolver({ url: XPLANE_URLS.nav }),
    lib.data.xplane.createEarthFixResolver({ url: XPLANE_URLS.fix }),
    lib.data.xplane.createEarthAwyResolver({ url: XPLANE_URLS.awy })
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
            (await nav.resolve({ navaid: query.navaid })) ??
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
    try {
      const collections = await Promise.all(
        FAA_URLS.map(async url => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`FAA data request failed: ${response.status} ${url}`);
          }
          return response.json();
        })
      );
      const faa = await lib.data.faa.createFaaArcgisResolver({ collections });
      resolver.withArcgis(faa);
    } catch (err) {
      console.warn("tangram_navaid: FAA source unavailable:", err);
    }
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

// --- Field 15 route parsing and resolution --------------------------------

export interface ParsedField15 {
  expression: string;
  elements: Field15Element[];
}

export type Field15ParseResult = { ok: true; value: ParsedField15 } | { ok: false };

function isField15Point(element: Field15Element): boolean {
  return (
    typeof element === "object" &&
    ("waypoint" in element ||
      "aerodrome" in element ||
      "coords" in element ||
      "point_bearing_distance" in element)
  );
}

export async function tryParseField15(expression: string): Promise<Field15ParseResult> {
  const normalized = expression.trim().toUpperCase();
  if (normalized.split(/\s+/).length < 3) return { ok: false };

  try {
    const lib = await loadTraffic();
    if (thrustModule) lib.env.setThrustWasm({ thrustModule });
    const elements = await lib.data.parseField15(normalized);
    let points = 0;
    let hasRouteElement = false;
    for (const element of elements) {
      if (isField15Point(element)) points += 1;
      else hasRouteElement = true;
    }
    return points >= 2 && hasRouteElement
      ? { ok: true, value: { expression: normalized, elements } }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function resolveRoute(expression: string): Promise<RouteResolution> {
  const resolver = await getResolver();
  const route = await resolver.enrichRouteAsGeoJSON(expression);
  const points = resolver.extractRoutePointsAsGeoJSON(route);
  return {
    route: route as FeatureCollection<LineStringFeature>,
    points: points as FeatureCollection<
      PointFeature<{ ident: string; kind: string | null }>
    >
  };
}
