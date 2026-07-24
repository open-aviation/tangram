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
  searchNavaids,
  searchFixes,
  tryParseField15,
  resolveRoute,
  type NavFeatureProperties,
  type FixFeatureProperties,
  type PointFeature,
  type ParsedField15
} from "./traffic";
import { drawRoute } from "./routeLayer";
import { drawPoint, type NavPointInfo } from "./pointLayer";

const NAV_LIMIT = 8;

interface NavaidConfig {
  enable_faa?: boolean;
}

type AnyFeature =
  PointFeature<NavFeatureProperties> | PointFeature<FixFeatureProperties>;

/** A drawn map item (point or route) plus its bookkeeping for removal. */
interface DrawnItem {
  id: string;
  disposable: Disposable;
}

function scoreNavResult(query: string, ident: string, name: string): number {
  const q = query.trim().toUpperCase();
  const id = (ident ?? "").toUpperCase();
  if (id === q) return 100;
  if (id.startsWith(q)) return 85;
  if ((name ?? "").toUpperCase().includes(q)) return 65;
  return 50;
}

export async function install(ctx: PluginContext, config: NavaidConfig = {}) {
  const api = ctx.api;

  // Accumulated map items — many points and many routes can coexist. Each is
  // disposable; clicking an item opens a remove menu (handled inside its layer).
  const points: DrawnItem[] = [];
  const routes: DrawnItem[] = [];
  let disposed = false;
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
      disposed = true;
      for (const item of [...points, ...routes]) item.disposable.dispose();
      points.length = 0;
      routes.length = 0;
    }
  });

  const featureToResult = (query: string, feature: AnyFeature): SearchResult => {
    const p = feature.properties;
    const isFix = p.kind === "fix";
    const frequency =
      !isFix && "frequency" in p ? (p as NavFeatureProperties).frequency : undefined;
    const elevationFt =
      !isFix && "elevation_ft" in p
        ? ((p as NavFeatureProperties).elevation_ft ?? null)
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

  configureTraffic({ enableFaa: config.enable_faa });

  // esm.sh exposes a browser `process` polyfill with `versions.node`. traffic.js
  // mistakes that for Node, tries bare `thrust-wasm` imports, and returns before
  // its browser CDN fallbacks. Import the plugin-owned web build explicitly.
  let field15Promise: Promise<void> | null = null;
  const prepareField15 = () => {
    if (!field15Promise) {
      field15Promise = ctx
        .importModule<typeof import("thrust-wasm/web")>("thrust_wasm.js")
        .then(setThrustModule)
        .catch(err => {
          field15Promise = null;
          throw err;
        });
    }
    return field15Promise;
  };

  const drawRouteExpression = async ({ expression }: ParsedField15) => {
    try {
      const resolution = await resolveRoute(expression);
      if (disposed) return;
      if (!resolution.route.features.length) {
        console.warn("tangram_navaid: no route segments resolved for", expression);
        return;
      }

      const id = nextId("route");
      const disposable = drawRoute(api, ctx.id, id, resolution, () =>
        removeItem(routes, id)
      );
      if (disposed) {
        disposable.dispose();
        return;
      }
      routes.push({ id, disposable });
    } catch (err) {
      if (!disposed) {
        console.warn("tangram_navaid: route resolution failed:", err);
      }
    }
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
      if (query.trim().length < 2 || signal.aborted) return [];

      try {
        await prepareField15();
      } catch {
        return [];
      }
      if (signal.aborted) return [];

      const parsed = await tryParseField15(query);
      if (signal.aborted || !parsed.ok) return [];

      return [
        {
          id: "tangram-navaid-route-custom",
          score: 90,
          component: Field15Result,
          props: { expression: parsed.value.expression, label: "Resolve & draw route" },
          onSelect: () => drawRouteExpression(parsed.value)
        }
      ];
    }
  });
}
