import type {
  PluginContext,
  SearchResult,
  Disposable
} from "@open-aviation/tangram-core/api";
import NavaidResult from "./NavaidResult.vue";
import Field15Result from "./Field15Result.vue";
import {
  configureTraffic,
  setThrustModule,
  getResolver,
  searchNavaids,
  searchFixes,
  resolveRoute,
  type NavFeatureProperties,
  type FixFeatureProperties,
  type PointFeature
} from "./traffic";
import { drawRoute } from "./routeLayer";
import { drawPoint, type NavPointInfo } from "./pointLayer";

const NAV_LIMIT = 8;

type AnyFeature =
  | PointFeature<NavFeatureProperties>
  | PointFeature<FixFeatureProperties>;

/** A drawn map item (point or route) plus its bookkeeping for removal. */
interface DrawnItem {
  id: string;
  disposable: Disposable;
}

/**
 * Decide whether a typed query should be offered as a Field 15 route
 * expression to resolve (rather than just a point designator). We require at
 * least two tokens plus a recognisable route shape: a speed/level prefix, a
 * DCT connector, a lat/lon coordinate, or an airway / SID / STAR designator.
 */
function looksLikeRoute(query: string): boolean {
  const text = query.trim();
  if (!text) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  if (/^[NKM]\d{3,4}(F\d{3}|S\d{4}|A\d{3}|M\d{4})/.test(tokens[0])) return true;
  if (/\bDCT\b/.test(text)) return true;
  if (/\b\d{2,4}[NS]\d{2,5}[EW]\b/.test(text)) return true;
  if (tokens.some(token => /^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(token))) return true;
  if (tokens.some(token => /^[A-Z]{2,5}\d[A-Z]$/.test(token))) return true;
  return false;
}

function scoreNavResult(query: string, ident: string, name: string): number {
  const q = query.trim().toUpperCase();
  const id = (ident ?? "").toUpperCase();
  if (id === q) return 100;
  if (id.startsWith(q)) return 85;
  if ((name ?? "").toUpperCase().includes(q)) return 65;
  return 50;
}

export async function install(
  ctx: PluginContext,
  config?: Record<string, unknown>
) {
  const api = ctx.api;

  // Accumulated map items — many points and many routes can coexist. Each is
  // disposable; clicking an item opens a remove menu (handled inside its layer).
  const points: DrawnItem[] = [];
  const routes: DrawnItem[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const removeItem = (list: DrawnItem[], id: string) => {
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return;
    list[index].disposable.dispose();
    list.splice(index, 1);
  };

  ctx.onDispose({
    dispose: () => {
      for (const item of [...points, ...routes]) item.disposable.dispose();
      points.length = 0;
      routes.length = 0;
    }
  });

  const featureToResult = (query: string, feature: AnyFeature): SearchResult => {
    const p = feature.properties;
    const isFix = p.kind === "fix";
    const frequency =
      !isFix && "frequency" in p
        ? (p as NavFeatureProperties).frequency
        : undefined;
    const elevationFt =
      !isFix && "elevation_ft" in p
        ? (p as NavFeatureProperties).elevation_ft ?? null
        : null;
    const lon = feature.geometry.coordinates[0];
    const lat = feature.geometry.coordinates[1];

    return {
      id: `tangram-navaid-${isFix ? "fix" : "navaid"}-${p.ident}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
      score: scoreNavResult(query, p.ident, p.name),
      component: NavaidResult,
      props: {
        ident: p.ident,
        name: p.name,
        kind: p.kind,
        lat,
        lon,
        frequency: frequency ?? null
      },
      onSelect: () => {
        const id = nextId("point");
        const disposable = drawPoint(
          api,
          ctx.id,
          id,
          {
            ident: p.ident,
            name: p.name,
            kind: p.kind,
            lat,
            lon,
            elevationFt
          } satisfies NavPointInfo,
          () => removeItem(points, id)
        );
        points.push({ id, disposable });
        api.map.getMapInstance().flyTo({
          center: [lon, lat],
          zoom: 9,
          speed: 1.2
        });
      }
    };
  };

  configureTraffic({
    trafficJsUrl: (config?.traffic_js_url as string | undefined) ?? null,
    ddrArchiveUrl: (config?.ddr_archive_url as string | undefined) ?? null,
    enableFaa: Boolean(config?.enable_faa)
  });

  // Load the locally-bundled thrust-wasm (plugin asset) and hand it to traffic.js
  // before any resolver is built. traffic.js initialises the WASM binary itself
  // (via thrustModule.default()) when it first creates the DDR resolver.
  try {
    const thrust =
      await ctx.importModule<typeof import("thrust-wasm/web")>("thrust_wasm.js");
    setThrustModule(thrust);
  } catch (err) {
    console.warn("tangram_navaid: thrust-wasm asset could not be loaded:", err);
  }

  // Pre-warm: start loading traffic.js and fetching X-Plane navdata now so the
  // first search is fast. Failures are non-fatal (the providers degrade to []).
  getResolver().catch((err: unknown) =>
    console.warn("tangram_navaid: pre-warm failed:", err)
  );

  const drawRouteExpression = (expression: string) => {
    const id = nextId("route");
    resolveRoute(expression)
      .then(resolution => {
        if (!resolution.route.features.length) {
          console.warn(
            "tangram_navaid: no route segments resolved for",
            expression,
            "— configure ddr_archive_url for full airway/airport resolution"
          );
        }
        const disposable = drawRoute(
          api,
          ctx.id,
          id,
          resolution,
          () => removeItem(routes, id)
        );
        routes.push({ id, disposable });
      })
      .catch((err: unknown) =>
        console.warn("tangram_navaid: route resolution failed:", err)
      );
  };

  // --- navaids + fixes -----------------------------------------------------

  api.search.registerProvider({
    id: "tangram-navaid-nav",
    pluginId: ctx.id,
    name: "Navigation data (navaids & fixes)",
    search: async (query, signal) => {
      const q = query.trim();
      if (q.length < 2 || signal.aborted) return [];
      try {
        const [navaids, fixes] = await Promise.all([
          searchNavaids(q, NAV_LIMIT),
          searchFixes(q, NAV_LIMIT)
        ]);
        if (signal.aborted) return [];

        const features: AnyFeature[] = [...navaids, ...fixes];
        return features
          .map(feature => featureToResult(q, feature))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, NAV_LIMIT);
      } catch (err) {
        console.warn("tangram_navaid: navaid/fix search failed:", err);
        return [];
      }
    }
  });

  // --- Field 15 routes -----------------------------------------------------

  api.search.registerProvider({
    id: "tangram-navaid-field15",
    pluginId: ctx.id,
    name: "Field 15 route",
    search: async (query, signal) => {
      const q = query.trim();
      if (q.length < 2 || signal.aborted) return [];

      if (!looksLikeRoute(q)) return [];

      return [
        {
          id: "tangram-navaid-route-custom",
          score: 90,
          component: Field15Result,
          props: { expression: q, label: "Resolve & draw route" },
          onSelect: () => drawRouteExpression(q)
        }
      ];
    }
  });
}
