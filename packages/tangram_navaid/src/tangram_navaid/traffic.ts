import type { Field15Element, LookupSource, ResolveQuery } from "traffic.js";

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

type SearchFeature = {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { ident: string; name?: string; kind: string; source?: string };
};

type SearchIndex<F extends SearchFeature> = {
  byIdent: Map<string, F[]>;
  records: Array<{ feature: F; ident: string; name: string }>;
};

type XplaneSource = LookupSource & {
  navaids: EarthNavResolver["navaids"];
  fixes: EarthFixResolver["fixes"];
  airways: EarthAwyResolver["airways"];
};

export type NavaidFeature = Awaited<
  ReturnType<EarthNavResolver["navaids"]["data"]>
>[number];
export type FixFeature = Awaited<ReturnType<EarthFixResolver["fixes"]["data"]>>[number];
type RouteFeatureCollection = Awaited<
  ReturnType<ResolverInstance["enrichRouteAsGeoJSON"]>
>;
type RoutePointCollection = ReturnType<ResolverInstance["extractRoutePointsAsGeoJSON"]>;

export interface RouteResolution {
  route: RouteFeatureCollection;
  points: RoutePointCollection;
}

export interface ParsedField15 {
  expression: string;
  elements: Field15Element[];
}

type Field15ParseResult = { ok: true; value: ParsedField15 } | { ok: false };

interface NavaidServiceOptions {
  loadThrustModule: () => Promise<unknown>;
}

interface NavaidService {
  searchNavaids(query: string, limit: number): Promise<NavaidFeature[]>;
  searchFixes(query: string, limit: number): Promise<FixFeature[]>;
  tryParseField15(expression: string): Promise<Field15ParseResult>;
  resolveRoute(expression: string, enableFaa: boolean): Promise<RouteResolution>;
}

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

function retryable<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      const current = load().catch(error => {
        if (promise === current) promise = null;
        throw error;
      });
      promise = current;
    }
    return promise;
  };
}

function buildSearchIndex<F extends SearchFeature>(features: F[]): SearchIndex<F> {
  const byIdent = new Map<string, F[]>();
  const records: SearchIndex<F>["records"] = [];

  for (const feature of features) {
    const ident = feature.properties.ident.trim().toUpperCase();
    if (!ident) continue;

    const bucket = byIdent.get(ident);
    if (bucket) bucket.push(feature);
    else byIdent.set(ident, [feature]);

    records.push({
      feature,
      ident,
      name: feature.properties.name?.trim().toUpperCase() ?? ""
    });
  }

  return { byIdent: byIdent, records: records };
}

function rankFromIndex<F extends SearchFeature>(
  index: SearchIndex<F>,
  query: string,
  limit: number
): F[] {
  const exact = index.byIdent.get(query) ?? [];
  if (exact.length >= limit) return exact.slice(0, limit);

  const prefix: F[] = [];
  const name: F[] = [];
  for (const record of index.records) {
    if (record.ident === query) continue;
    if (record.ident.startsWith(query)) prefix.push(record.feature);
    else if (record.name.includes(query)) name.push(record.feature);
  }

  return [...exact, ...prefix, ...name].slice(0, limit);
}

function isField15Point(element: Field15Element): boolean {
  return (
    typeof element === "object" &&
    ("waypoint" in element ||
      "aerodrome" in element ||
      "coords" in element ||
      "point_bearing_distance" in element)
  );
}

function isField15Procedure(element: Field15Element): boolean {
  return typeof element === "object" && ("SID" in element || "STAR" in element);
}

export function isField15Candidate(expression: string): boolean {
  return expression.trim().split(/\s+/).length >= 2;
}

export function createNavaidService(options: NavaidServiceOptions): NavaidService {
  const traffic = retryable(async (): Promise<TrafficLib> => {
    const { data, env } = await import("traffic.js");
    return { data, env };
  });
  // traffic.js stores wasm globally so initialization is not tied to plugin disposal
  const field15Runtime = retryable(async () => {
    const [lib, thrustModule] = await Promise.all([
      traffic(),
      options.loadThrustModule()
    ]);
    lib.env.setThrustWasm({ thrustModule });
    return lib;
  });

  const nav = retryable(async () => {
    const lib = await traffic();
    return lib.data.xplane.createEarthNavResolver({ url: XPLANE_URLS.nav });
  });
  const fix = retryable(async () => {
    const lib = await traffic();
    return lib.data.xplane.createEarthFixResolver({ url: XPLANE_URLS.fix });
  });
  const awy = retryable(async () => {
    const lib = await traffic();
    return lib.data.xplane.createEarthAwyResolver({ url: XPLANE_URLS.awy });
  });
  // both source variants share the same wasm-backed ddr data
  const ddr = retryable(async () => {
    const lib = await field15Runtime();
    return lib.data.eurocontrol.createEurocontrolDdrResolver({
      archiveUrl: DDR_ARCHIVE_URL
    });
  });
  const navIndex = retryable(async () =>
    buildSearchIndex(await (await nav()).navaids.data())
  );
  const fixIndex = retryable(async () =>
    buildSearchIndex(await (await fix()).fixes.data())
  );

  async function buildResolver(enableFaa: boolean): Promise<ResolverInstance> {
    const [lib, navResolver, fixResolver, awyResolver, ddrResolver] = await Promise.all(
      [field15Runtime(), nav(), fix(), awy(), ddr()]
    );

    const xplane: XplaneSource = {
      navaids: navResolver.navaids,
      fixes: fixResolver.fixes,
      airways: awyResolver.airways,
      resolve: async (query: ResolveQuery) => {
        if (query.airway) return awyResolver.resolve(query);
        if (query.navaid) {
          return (
            (await navResolver.resolve({ navaid: query.navaid })) ??
            fixResolver.resolve({ fix: query.navaid })
          );
        }
        if (query.fix) {
          return (
            (await fixResolver.resolve({ fix: query.fix })) ??
            navResolver.resolve({ navaid: query.fix })
          );
        }
        return null;
      },
      // resolver requires an enrich-capable source to use x-plane for point lookup
      enrichRoute: () => []
    };

    const resolver = new lib.data.Resolver().withSource("xplane", xplane);
    resolver.withDdr(ddrResolver);

    if (enableFaa) {
      try {
        const collections = await Promise.all(
          FAA_URLS.map(async url => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`FAA data request failed: ${response.status} ${url}`);
            }
            return (await response.json()) as unknown;
          })
        );
        resolver.withArcgis(
          await lib.data.faa.createFaaArcgisResolver({ collections })
        );
      } catch (error) {
        console.warn("tangram_navaid: FAA source unavailable:", error);
      }
    }

    return resolver;
  }

  // source configuration has only two immutable resolver variants
  const resolverWithoutFaa = retryable(() => buildResolver(false));
  const resolverWithFaa = retryable(() => buildResolver(true));

  return {
    async searchNavaids(query, limit) {
      return rankFromIndex(await navIndex(), query.trim().toUpperCase(), limit);
    },
    async searchFixes(query, limit) {
      return rankFromIndex(await fixIndex(), query.trim().toUpperCase(), limit);
    },
    async tryParseField15(expression) {
      // NOTE: the upstream parser currently accepts some non-ICAO forms and can
      // drop or misclassify ambiguous tokens. check only for a route-like AST.
      const normalized = expression.trim().replace(/\s+/g, " ").toUpperCase();
      if (!isField15Candidate(normalized)) return { ok: false };

      try {
        const lib = await field15Runtime();
        const elements = await lib.data.parseField15(normalized);
        const pointCount = elements.filter(isField15Point).length;
        // procedures may sit at a field boundary but map geometry still needs one point anchor
        return pointCount >= 2 || (pointCount >= 1 && elements.some(isField15Procedure))
          ? { ok: true, value: { expression: normalized, elements } }
          : { ok: false };
      } catch {
        return { ok: false };
      }
    },
    async resolveRoute(expression, enableFaa) {
      // the resolver reparses the original expression. presentation therefore
      // reconciles ordered token and geometry occurrences.
      const resolver = await (enableFaa ? resolverWithFaa() : resolverWithoutFaa());
      const route = await resolver.enrichRouteAsGeoJSON(expression);
      return {
        route,
        // repeated token occurrences intentionally share one physical map marker
        points: resolver.extractRoutePointsAsGeoJSON(route)
      };
    }
  };
}
