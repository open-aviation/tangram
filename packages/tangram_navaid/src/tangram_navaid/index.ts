import { defineComponent, h, watch, type PropType } from "vue";
import type {
  MapBounds,
  PluginContext,
  SearchResult,
  WorkspaceDatasetEntry
} from "@open-aviation/tangram-core/api";
import { highlightTextParts } from "@open-aviation/tangram-core/utils";
import Field15Tokens from "./Field15Tokens.vue";
import NavaidDatasetChip from "./NavaidDatasetChip.vue";
import NavaidDatasetDetails from "./NavaidDatasetDetails.vue";
import NavaidLayers from "./NavaidLayers.vue";
import NavaidResult from "./NavaidResult.vue";
import {
  NAVAID_POINT_KIND,
  PLANNED_ROUTE_KIND,
  isPlannedRouteEntry,
  NavaidPoint,
  type PlannedRouteEntry,
  type PlannedRouteInput,
  ResolvedRoute,
  type PlannedRouteResolution
} from "./datasets";
import { Field15Presentation } from "./field15Tokens";
import { NavaidInteraction } from "./interaction";
import {
  createNavaidService,
  isField15Candidate,
  type FixFeature,
  type NavaidFeature,
  type ParsedField15
} from "./traffic";

const NAV_LIMIT = 8;

interface NavaidConfig {
  enable_faa?: boolean;
}

class RouteJob {
  private value: ResolvedRoute | null;
  private promise: Promise<ResolvedRoute> | null = null;

  constructor(
    private readonly load: () => Promise<ResolvedRoute>,
    initialValue: ResolvedRoute | null = null
  ) {
    this.value = initialValue;
  }

  peek(): ResolvedRoute | null {
    return this.value;
  }

  resolve(): Promise<ResolvedRoute> {
    if (this.value) return Promise.resolve(this.value);
    this.promise ??= this.load()
      .then(route => {
        this.value = route;
        return route;
      })
      .catch(error => {
        this.promise = null;
        throw error;
      });
    return this.promise;
  }
}

type AnyFeature = NavaidFeature | FixFeature;

function scoreNavResult(query: string, ident: string, name: string): number {
  const normalized = query.trim().toUpperCase();
  const normalizedIdent = ident.toUpperCase();
  if (normalizedIdent === normalized) return 100;
  if (normalizedIdent.startsWith(normalized)) return 85;
  if (name.toUpperCase().includes(normalized)) return 65;
  return 50;
}

function pointEntryId(feature: AnyFeature): string {
  const [longitude, latitude] = feature.geometry.coordinates;
  const properties = feature.properties;
  return [
    "tangram-navaid",
    properties.kind,
    properties.ident,
    properties.source ?? "xplane",
    latitude,
    longitude
  ]
    .map(String)
    .map(encodeURIComponent)
    .join(":");
}

function routeWorkspaceLabel(
  elements: ParsedField15["elements"],
  resolution?: PlannedRouteResolution
): string {
  const label = Field15Presentation.routeLabel(elements);
  if (!resolution || resolution.status === "resolving") return label;
  if (resolution.status === "error") return `${label} · resolution failed`;
  const count = resolution.route.geometry.legs.length;
  return `${label} · ${count} ${count === 1 ? "leg" : "legs"}`;
}

function withRouteResolution(
  entry: WorkspaceDatasetEntry,
  expression: string,
  resolution: PlannedRouteResolution
): WorkspaceDatasetEntry | undefined {
  if (!isPlannedRouteEntry(entry) || entry.payload.expression !== expression) return;
  return {
    ...entry,
    label: routeWorkspaceLabel(entry.payload.elements, resolution),
    bounds: resolution.status === "resolved" ? resolution.route.bounds : null,
    payload: { ...entry.payload, resolution }
  };
}

export async function install(ctx: PluginContext, config?: NavaidConfig) {
  const api = ctx.api;
  const interaction = new NavaidInteraction();
  const service = createNavaidService({
    loadThrustModule: () =>
      ctx.importModule<typeof import("thrust-wasm/web")>("thrust_wasm.js")
  });
  const pendingFits = new Map<string, number>();
  // only resolving workspace rows retain jobs
  const workspaceJobs = new Map<string, RouteJob>();
  let cameraIntent = 0;

  const stopMapWatch = watch(
    () => api.map.map.value,
    (map, _previous, onCleanup) => {
      if (!map) return;
      // any map movement invalidates a pending async fit
      const invalidatePendingFit = () => {
        cameraIntent += 1;
      };
      map.on("movestart", invalidatePendingFit);
      onCleanup(() => map.off("movestart", invalidatePendingFit));
    },
    { immediate: true }
  );

  ctx.onDispose({ dispose: stopMapWatch });
  ctx.onDispose({
    dispose: () => {
      pendingFits.clear();
      workspaceJobs.clear();
      interaction.clearHover();
    }
  });

  if (config) {
    ctx.onDispose({
      dispose: watch(
        () => config.enable_faa,
        () => api.search.refresh()
      )
    });
  }

  function claimCamera(): number {
    cameraIntent += 1;
    return cameraIntent;
  }

  function fitBounds(bounds: MapBounds, intent: number, entryId?: string): void {
    if (intent !== cameraIntent) return;
    if (entryId) {
      const entry = api.workspace.datasets.value.find(
        dataset => dataset.id === entryId
      );
      if (!entry?.visible) return;
    }
    const map = api.map.map.value;
    if (!map) return;
    cameraIntent += 1;
    map.fitBounds(
      [
        [bounds.minLon, bounds.minLat],
        [bounds.maxLon, bounds.maxLat]
      ],
      { padding: 60, maxZoom: 14 }
    );
  }

  async function resolveParsedRoute(
    parsed: ParsedField15,
    enableFaa: boolean
  ): Promise<ResolvedRoute> {
    const resolution = await service.resolveRoute(parsed.expression, enableFaa);
    if (resolution.route.features.length === 0) {
      throw new Error("no route segments resolved");
    }
    return ResolvedRoute.fromResolution(parsed.elements, resolution);
  }

  function resolveRouteEntry(
    entryId: string,
    parsed: ParsedField15,
    job: RouteJob
  ): void {
    workspaceJobs.set(entryId, job);
    void job
      .resolve()
      .then(route => {
        if (ctx.signal.aborted || workspaceJobs.get(entryId) !== job) return;
        workspaceJobs.delete(entryId);
        const updated = api.workspace.update(entryId, entry =>
          withRouteResolution(entry, parsed.expression, { status: "resolved", route })
        );
        const intent = pendingFits.get(entryId);
        pendingFits.delete(entryId);
        if (updated && intent !== undefined && route.bounds) {
          fitBounds(route.bounds, intent, entryId);
        }
      })
      .catch(error => {
        if (workspaceJobs.get(entryId) !== job) return;
        workspaceJobs.delete(entryId);
        pendingFits.delete(entryId);
        if (ctx.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        api.workspace.update(entryId, entry =>
          withRouteResolution(entry, parsed.expression, { status: "error", message })
        );
      });
  }

  const detailsComponent = defineComponent({
    name: "NavaidWorkspaceDetails",
    props: {
      dataset: {
        type: Object as PropType<WorkspaceDatasetEntry>,
        required: true
      }
    },
    setup(props) {
      return () =>
        h(NavaidDatasetDetails, {
          dataset: props.dataset,
          interaction: interaction
        });
    }
  });

  api.ui.registerWorkspaceComponents(NAVAID_POINT_KIND, {
    pluginId: ctx.id,
    chip: NavaidDatasetChip,
    details: detailsComponent
  });
  api.ui.registerWorkspaceComponents(PLANNED_ROUTE_KIND, {
    pluginId: ctx.id,
    chip: NavaidDatasetChip,
    details: detailsComponent
  });
  api.ui.registerWidget("tangram-navaid-layers", "MapOverlay", NavaidLayers, {
    pluginId: ctx.id,
    props: { pluginId: ctx.id, interaction: interaction }
  });

  function featureToResult(query: string, feature: AnyFeature): SearchResult {
    const properties = feature.properties;
    const [longitude, latitude] = feature.geometry.coordinates;
    const point = NavaidPoint.fromFeature(feature);

    const entryId = pointEntryId(feature);
    return {
      id: entryId,
      score: scoreNavResult(query, properties.ident, properties.name),
      component: NavaidResult,
      props: {
        point,
        identParts: highlightTextParts(point.ident, query),
        nameParts: highlightTextParts(point.name || point.ident, query)
      },
      onSelect: () => {
        if (ctx.signal.aborted) return;
        claimCamera();
        // search and workspace share identity so selecting a point is idempotent
        api.workspace.add({
          id: entryId,
          kind: NAVAID_POINT_KIND,
          pluginId: ctx.id,
          label: point.ident,
          payload: { type: "point", point },
          bounds: point.bounds
        });
        api.map.map.value?.flyTo({
          center: [longitude, latitude],
          zoom: 9,
          speed: 1.2
        });
      }
    };
  }

  function findRoute(expression: string): PlannedRouteEntry | undefined {
    return api.workspace.datasets.value.find(
      (entry): entry is PlannedRouteEntry =>
        isPlannedRouteEntry(entry) && entry.payload.expression === expression
    );
  }

  function addRoute(parsed: ParsedField15, job: RouteJob): void {
    if (ctx.signal.aborted) return;
    const intent = claimCamera();
    const existing = findRoute(parsed.expression);
    if (existing) {
      api.workspace.setVisibility(existing.id, true);
      if (existing.payload.resolution.status === "resolved") {
        if (existing.bounds) fitBounds(existing.bounds, intent, existing.id);
        return;
      }

      pendingFits.set(existing.id, intent);
      const resolved = job.peek();
      if (resolved) {
        workspaceJobs.delete(existing.id);
        api.workspace.update(existing.id, entry =>
          withRouteResolution(entry, parsed.expression, {
            status: "resolved",
            route: resolved
          })
        );
        pendingFits.delete(existing.id);
        if (resolved.bounds) fitBounds(resolved.bounds, intent, existing.id);
      } else if (!workspaceJobs.has(existing.id)) {
        api.workspace.update(existing.id, entry =>
          withRouteResolution(entry, parsed.expression, { status: "resolving" })
        );
        resolveRouteEntry(existing.id, parsed, job);
      }
      return;
    }

    const resolved = job.peek();
    const resolution: PlannedRouteResolution = resolved
      ? { status: "resolved", route: resolved }
      : { status: "resolving" };
    const entryId = crypto.randomUUID();
    api.workspace.add({
      id: entryId,
      kind: PLANNED_ROUTE_KIND,
      pluginId: ctx.id,
      label: routeWorkspaceLabel(parsed.elements, resolution),
      payload: {
        type: "route",
        expression: parsed.expression,
        elements: parsed.elements,
        resolution
      },
      bounds: resolved?.bounds ?? null,
      dispose: () => {
        workspaceJobs.delete(entryId);
        pendingFits.delete(entryId);
      }
    } satisfies PlannedRouteInput);

    if (resolved) {
      if (resolved.bounds) fitBounds(resolved.bounds, intent, entryId);
    } else {
      pendingFits.set(entryId, intent);
      resolveRouteEntry(entryId, parsed, job);
    }
  }

  api.search.registerProvider({
    id: "tangram-navaid-nav",
    pluginId: ctx.id,
    name: "Navigation data (navaids & fixes)",
    search: async (query, signal) => {
      const normalized = query.trim();
      if (
        normalized.length < 2 ||
        /\s/.test(normalized) ||
        signal.aborted ||
        ctx.signal.aborted
      ) {
        return [];
      }
      try {
        const [navaids, fixes] = await Promise.all([
          service.searchNavaids(normalized, NAV_LIMIT),
          service.searchFixes(normalized, NAV_LIMIT)
        ]);
        if (signal.aborted || ctx.signal.aborted) return [];
        return [...navaids, ...fixes]
          .map(feature => featureToResult(normalized, feature))
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
          .slice(0, NAV_LIMIT);
      } catch (error) {
        if (!signal.aborted && !ctx.signal.aborted) {
          console.warn("tangram_navaid: navigation search failed:", error);
        }
        return [];
      }
    }
  });

  api.search.registerProvider({
    id: "tangram-navaid-field15",
    pluginId: ctx.id,
    name: "Field 15 route",
    search: async (query, signal) => {
      if (signal.aborted || ctx.signal.aborted || !isField15Candidate(query)) return [];
      const parsed = await service.tryParseField15(query);
      if (signal.aborted || ctx.signal.aborted || !parsed.ok) return [];

      const value = parsed.value;
      const resultId = `tangram-navaid-route:${encodeURIComponent(value.expression)}`;
      const existing = findRoute(value.expression);
      const resolved =
        existing?.payload.resolution.status === "resolved"
          ? existing.payload.resolution.route
          : null;
      // Reuse workspace-owned work; otherwise resolution begins only on selection.
      const enableFaa = config?.enable_faa ?? false;
      const job =
        (existing?.payload.resolution.status === "resolving"
          ? workspaceJobs.get(existing.id)
          : undefined) ??
        new RouteJob(() => resolveParsedRoute(value, enableFaa), resolved);

      return [
        {
          id: resultId,
          score: 90,
          component: Field15Tokens,
          props: { elements: value.elements },
          onSelect: () => addRoute(value, job)
        }
      ];
    }
  });
}
