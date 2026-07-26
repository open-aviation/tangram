<template>
  <div class="color-probes" aria-hidden="true">
    <span ref="routeProbe" class="route-probe"></span>
    <span ref="warningProbe" class="warning-probe"></span>
    <span ref="pointProbe" class="point-probe"></span>
    <span ref="casingProbe" class="casing-probe"></span>
    <span ref="highlightProbe" class="highlight-probe"></span>
  </div>
  <div
    v-if="hover"
    class="deck-tooltip"
    :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
  >
    <div class="tooltip-grid">
      <div class="tooltip-title">
        <SvgIcon
          v-if="hover.tooltip.warningCategory"
          class="tooltip-warning"
          :class="`navaid-token-${hover.tooltip.warningCategory}`"
          :path="ICON_PATHS.warning"
        />
        <span>{{ hover.tooltip.title }}</span>
      </div>
      <div class="tooltip-type">{{ hover.tooltip.type }}</div>
      <div v-if="hover.tooltip.subtitle" class="tooltip-subtitle">
        {{ hover.tooltip.subtitle }}
      </div>
      <div
        v-for="warning in hover.tooltip.warnings"
        :key="warning"
        class="tooltip-warning-detail"
      >
        {{ warning }}
      </div>
      <template
        v-for="(row, index) in hover.tooltip.rows"
        :key="`${index}-${row.primary}-${row.secondary ?? ''}`"
      >
        <div :class="{ 'tooltip-row-wide': row.secondary === undefined }">
          {{ row.primary }}
        </div>
        <div v-if="row.secondary !== undefined" class="tooltip-right">
          {{ row.secondary }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowReactive,
  watch
} from "vue";
import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Disposable, TangramApi } from "@open-aviation/tangram-core/api";
import { SvgIcon } from "@open-aviation/tangram-core/components";
import {
  ICON_PATHS,
  parseColorSpec,
  type DeckGLColor
} from "@open-aviation/tangram-core/utils";
import {
  isNavaidDatasetEntry,
  isNavaidPointEntry,
  isPlannedRouteEntry,
  NavaidPoint,
  type NavaidDatasetEntry,
  type ResolvedRoute
} from "./datasets";
import {
  APPROXIMATE_TRACK_WARNING,
  isApproximateTrackSegment,
  isRouteWarningSegment,
  type Field15TokenCategory
} from "./field15Tokens";
import type { RouteLeg, RoutePoint } from "./geometry";
import {
  NavaidTooltip,
  type NavaidInteraction,
  type NavaidInteractionClaim
} from "./interaction";

const props = defineProps<{ pluginId: string; interaction: NavaidInteraction }>();
const api = inject<TangramApi>("tangramApi")!;
const entries = computed(() =>
  api.workspace.datasets.value.filter(isNavaidDatasetEntry)
);
const activeDatasetId = api.workspace.activeDatasetId;

/** Rendered point occurrence, with stable keys back to workspace and field-15 tokens. */
class MapPointDatum {
  private constructor(
    readonly key: string,
    readonly entryId: string,
    readonly point: NavaidPoint,
    readonly position: [number, number],
    readonly routePoint: boolean,
    readonly tokenIndices: number[]
  ) {}

  static fromNavaid(entryId: string, point: NavaidPoint): MapPointDatum {
    return new MapPointDatum(
      `${entryId}:point`,
      entryId,
      point,
      [point.longitude, point.latitude],
      false,
      []
    );
  }

  static fromRoutePoint(
    entryId: string,
    feature: RoutePoint,
    index: number,
    tokenIndices: number[]
  ): MapPointDatum {
    return new MapPointDatum(
      `${entryId}:point:${index}`,
      entryId,
      NavaidPoint.fromFeature(feature),
      feature.geometry.coordinates,
      true,
      tokenIndices
    );
  }

  /** Fixes use the conventional triangle; resolver navaid subtypes share a circle. */
  get markerShape(): "circle" | "triangle" {
    return this.point.kind.toLowerCase() === "fix" ? "triangle" : "circle";
  }
}

/** Prepared route leg plus the token associations used by hover and warnings. */
class RouteLegDatum {
  private constructor(
    readonly key: string,
    readonly entryId: string,
    readonly leg: RouteLeg,
    readonly tokenIndices: number[],
    readonly tokenType: string | undefined,
    readonly warnings: string[],
    readonly warningCategory: Field15TokenCategory | undefined
  ) {}

  static fromRoute(entryId: string, route: ResolvedRoute, index: number): RouteLegDatum {
    const leg = route.geometry.legs[index];
    const tokenIndices = route.presentation.segmentTokenIndices.get(index) ?? [];
    const tokens = tokenIndices.flatMap(tokenIndex => {
      const token = route.presentation.tokens[tokenIndex];
      return token ? [token] : [];
    });
    // only use token metadata when the association is unambiguous
    const matchingTokens = tokens.filter(token => token.matchesSegment(leg.feature));
    const primaryToken =
      matchingTokens.length === 1
        ? matchingTokens[0]
        : tokens.length === 1
          ? tokens[0]
          : undefined;
    const warningTokens = tokens.filter(token => token.warnings.length);
    const warningToken =
      warningTokens.length === 1
        ? warningTokens[0]
        : primaryToken?.warnings.length
          ? primaryToken
          : undefined;
    const approximate = isApproximateTrackSegment(leg.feature);
    const routeWarning = isRouteWarningSegment(leg.feature);
    const warningMessages = new Set(tokens.flatMap(token => token.warnings));
    if (routeWarning) warningMessages.add("partially resolved");
    if (approximate) warningMessages.add(APPROXIMATE_TRACK_WARNING);
    const warnings = [...warningMessages];
    const warningCategory = warnings.length
      ? (warningToken?.category ??
        (approximate
          ? "track"
          : leg.feature.properties.connector?.toUpperCase() === "DCT"
            ? "direct"
            : "airway"))
      : undefined;
    return new RouteLegDatum(
      `${entryId}:segment:${index}`,
      entryId,
      leg,
      tokenIndices,
      primaryToken?.type,
      warnings,
      warningCategory
    );
  }

  get dashed(): boolean {
    return (
      isRouteWarningSegment(this.leg.feature) ||
      isApproximateTrackSegment(this.leg.feature)
    );
  }

  get dashPattern(): [number, number] {
    return isApproximateTrackSegment(this.leg.feature) ? [4, 2] : [1, 3];
  }

  tooltip(): NavaidTooltip {
    return NavaidTooltip.fromLeg(
      this.leg,
      this.tokenType,
      this.warnings,
      this.warningCategory
    );
  }
}

type MapHoverClaim = {
  kind: "point" | "segment";
  key: string;
  claim: NavaidInteractionClaim;
};

const routeProbe = ref<HTMLElement | null>(null);
const warningProbe = ref<HTMLElement | null>(null);
const pointProbe = ref<HTMLElement | null>(null);
const casingProbe = ref<HTMLElement | null>(null);
const highlightProbe = ref<HTMLElement | null>(null);
const themeColors = shallowReactive({
  route: [65, 125, 190, 255] as DeckGLColor,
  warning: [210, 75, 75, 255] as DeckGLColor,
  point: [65, 125, 190, 255] as DeckGLColor,
  casing: [30, 30, 30, 255] as DeckGLColor,
  highlight: [245, 245, 245, 255] as DeckGLColor
});

const BASE_ALPHA = Math.round(255 * 0.7);
const CASING_ALPHA = Math.round(255 * 0.35);
const DIM_ALPHA = 48;
const DIM_CASING_ALPHA = 24;
const routeStrokePixels = { casing: 3.9, base: 3, active: 5.1 } as const;
const pointRadiusPixels = { route: 4.8, standalone: 5.6 } as const;
const triangleSizePixels = { route: 12.8, standalone: 14.4 } as const;
const POINT_HALO_PIXELS = 2;
const TRIANGLE_HALO_PIXELS = 6;
const TRIANGLE_CASING_PIXELS = 2;
const TRIANGLE_ICON = {
  id: "tangram-navaid-fix-triangle",
  url: `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="white" d="M32 4 60 58H4Z"/></svg>'
  )}`,
  width: 64,
  height: 64,
  anchorX: 32,
  // hand tuned so center of mass coincides with true center
  anchorY: 18,
  mask: true
} as const;

const layerHandles = new Map<string, Disposable>();
let mapHover: MapHoverClaim | null = null;
let themeObserver: MutationObserver | null = null;

const dashExtension = new PathStyleExtension({ dash: true });

function readProbe(element: HTMLElement | null, fallback: DeckGLColor): DeckGLColor {
  if (!element) return fallback;
  return parseColorSpec(getComputedStyle(element).color) ?? fallback;
}

async function refreshThemeColors(): Promise<void> {
  await nextTick();
  themeColors.route = readProbe(routeProbe.value, themeColors.route);
  themeColors.warning = readProbe(warningProbe.value, themeColors.warning);
  themeColors.point = readProbe(pointProbe.value, themeColors.point);
  themeColors.casing = readProbe(casingProbe.value, themeColors.casing);
  themeColors.highlight = readProbe(highlightProbe.value, themeColors.highlight);
}

function withAlpha(color: DeckGLColor, alpha: number): DeckGLColor {
  return [color[0], color[1], color[2], alpha];
}

function datumAlpha(
  datum: MapPointDatum | RouteLegDatum,
  activeId: string | null
): number {
  return activeId === null || activeId === datum.entryId ? BASE_ALPHA : DIM_ALPHA;
}

function casingAlpha(
  datum: MapPointDatum | RouteLegDatum,
  activeId: string | null
): number {
  return activeId === null || activeId === datum.entryId
    ? CASING_ALPHA
    : DIM_CASING_ALPHA;
}

function pointMarkerRadius(datum: MapPointDatum): number {
  return datum.routePoint ? pointRadiusPixels.route : pointRadiusPixels.standalone;
}

function triangleMarkerSize(datum: MapPointDatum): number {
  return datum.routePoint ? triangleSizePixels.route : triangleSizePixels.standalone;
}

function activePointRadius(datum: MapPointDatum): number {
  return pointMarkerRadius(datum) + POINT_HALO_PIXELS;
}

function activeTriangleSize(datum: MapPointDatum): number {
  return triangleMarkerSize(datum) + TRIANGLE_HALO_PIXELS;
}

function appendRoute(
  points: MapPointDatum[],
  segments: RouteLegDatum[],
  entryId: string,
  route: ResolvedRoute
): void {
  segments.push(
    ...route.geometry.legs.map((_leg, index) =>
      RouteLegDatum.fromRoute(entryId, route, index)
    )
  );
  points.push(
    ...route.geometry.points.map((feature, index) =>
      MapPointDatum.fromRoutePoint(
        entryId,
        feature,
        index,
        route.presentation.pointTokenIndices.get(index) ?? []
      )
    )
  );
}

function buildLayerData(
  currentEntries: NavaidDatasetEntry[]
): { points: MapPointDatum[]; segments: RouteLegDatum[] } {
  const points: MapPointDatum[] = [];
  const segments: RouteLegDatum[] = [];

  for (const entry of currentEntries) {
    if (!entry.visible) continue;
    if (isNavaidPointEntry(entry)) {
      points.push(MapPointDatum.fromNavaid(entry.id, entry.payload.point));
      continue;
    }
    if (!isPlannedRouteEntry(entry) || entry.payload.resolution.status !== "resolved") {
      continue;
    }
    appendRoute(points, segments, entry.id, entry.payload.resolution.route);
  }

  return { points: points, segments: segments };
}

const layerData = computed(() => buildLayerData(entries.value));
const hover = computed(() => props.interaction.state.hover);

function mapClientPosition(x: number, y: number): [number, number] {
  const bounds = api.map.getMapInstance().getCanvasContainer().getBoundingClientRect();
  return [bounds.left + x, bounds.top + y];
}

function clearMapHover(): void {
  if (mapHover) props.interaction.releaseHover(mapHover.claim);
  mapHover = null;
}

function claimMapHover(
  kind: MapHoverClaim["kind"],
  key: string,
  target: Parameters<NavaidInteraction["claimHover"]>[0],
  tooltip: Parameters<NavaidInteraction["claimHover"]>[1],
  x: number,
  y: number
): void {
  if (
    mapHover?.kind === kind &&
    mapHover.key === key &&
    props.interaction.moveHover(mapHover.claim, x, y)
  ) {
    return;
  }
  clearMapHover();
  mapHover = {
    kind,
    key,
    claim: props.interaction.claimHover(target, tooltip, x, y)
  };
}

function handlePointHover(info: PickingInfo<MapPointDatum>): void {
  if (!info.object) {
    if (mapHover?.kind === "point") clearMapHover();
    return;
  }
  const datum = info.object;
  const [x, y] = mapClientPosition(info.x, info.y);
  claimMapHover(
    "point",
    datum.key,
    {
      entryId: datum.entryId,
      tokenIndices: datum.tokenIndices,
      pointKeys: [datum.key],
      segmentKeys: []
    },
    NavaidTooltip.fromPoint(datum.point),
    x,
    y
  );
}

function handleSegmentHover(info: PickingInfo<RouteLegDatum>): void {
  if (!info.object) {
    if (mapHover?.kind === "segment") clearMapHover();
    return;
  }
  const datum = info.object;
  const [x, y] = mapClientPosition(info.x, info.y);
  claimMapHover(
    "segment",
    datum.key,
    {
      entryId: datum.entryId,
      tokenIndices: datum.tokenIndices,
      pointKeys: [],
      segmentKeys: [datum.key]
    },
    datum.tooltip(),
    x,
    y
  );
}

function setLayer(layer: Layer, slot: "routes" | "highlights"): void {
  if (layerHandles.has(layer.id)) {
    api.map.setLayer(layer, { slot });
    return;
  }
  layerHandles.set(
    layer.id,
    api.map.setLayer(layer, { pluginId: props.pluginId, slot })
  );
}

watch(
  [layerData, activeDatasetId, () => hover.value?.target, themeColors],
  ([{ points, segments }, activeId, target]) => {
    const currentEntries = entries.value;
    const pointKeys = new Set(points.map(point => point.key));
    const segmentKeys = new Set(segments.map(segment => segment.key));
    const visibleEntryIds = new Set(
      currentEntries.filter(entry => entry.visible).map(entry => entry.id)
    );
    const targetRendered =
      !target ||
      (visibleEntryIds.has(target.entryId) &&
        target.pointKeys.every(key => pointKeys.has(key)) &&
        target.segmentKeys.every(key => segmentKeys.has(key)));
    const renderedTarget = targetRendered ? target : null;
    if (!targetRendered) {
      clearMapHover();
      props.interaction.clearHover();
    }

    const mapTargetId = renderedTarget?.entryId;
    // workspace focus dims other datasets even before the active route has rendered
    const relevantActiveId =
      mapTargetId ?? (visibleEntryIds.has(activeId ?? "") ? activeId : null);
    const activePointKeys = new Set(renderedTarget?.pointKeys ?? []);
    const activeSegmentKeys = new Set(renderedTarget?.segmentKeys ?? []);
    const solidSegments = segments.filter(segment => !segment.dashed);
    const dashedSegments = segments.filter(segment => segment.dashed);
    const activeSegments = segments.filter(segment =>
      activeSegmentKeys.has(segment.key)
    );
    const circlePoints = points.filter(point => point.markerShape === "circle");
    const trianglePoints = points.filter(point => point.markerShape === "triangle");
    const activeCirclePoints = circlePoints.filter(point =>
      activePointKeys.has(point.key)
    );
    const activeTrianglePoints = trianglePoints.filter(point =>
      activePointKeys.has(point.key)
    );

    // Casing is always solid. Only the route body carries warning/track dashes.
    const routeCasingLayer = new PathLayer<RouteLegDatum>({
      id: "tangram-navaid-route-casing",
      data: segments,
      widthUnits: "pixels",
      capRounded: true,
      getWidth: routeStrokePixels.casing,
      getPath: datum => datum.leg.feature.geometry.coordinates,
      getColor: datum => withAlpha(themeColors.casing, casingAlpha(datum, relevantActiveId))
    });
    const segmentLayer = new PathLayer<RouteLegDatum>({
      id: "tangram-navaid-routes",
      data: solidSegments,
      pickable: true,
      widthUnits: "pixels",
      getWidth: routeStrokePixels.base,
      getPath: datum => datum.leg.feature.geometry.coordinates,
      getColor: datum =>
        withAlpha(themeColors.route, datumAlpha(datum, relevantActiveId)),
      onHover: handleSegmentHover
    });
    const dashedLayer = new PathLayer<
      RouteLegDatum,
      PathStyleExtensionProps<RouteLegDatum>
    >({
      id: "tangram-navaid-dashed-routes",
      data: dashedSegments,
      pickable: true,
      widthUnits: "pixels",
      capRounded: true,
      getWidth: routeStrokePixels.base,
      getPath: datum => datum.leg.feature.geometry.coordinates,
      getColor: datum =>
        withAlpha(
          isApproximateTrackSegment(datum.leg.feature)
            ? themeColors.route
            : themeColors.warning,
          datumAlpha(datum, relevantActiveId)
        ),
      extensions: [dashExtension],
      getDashArray: datum => datum.dashPattern,
      onHover: handleSegmentHover
    });
    // Active warning legs are intentionally solid: dashes describe route state,
    // while the theme-adaptive underlay describes the interaction target.
    const activeSegmentLayer = new PathLayer<RouteLegDatum>({
      id: "tangram-navaid-active-route",
      data: activeSegments,
      widthUnits: "pixels",
      getWidth: routeStrokePixels.active,
      getPath: datum => datum.leg.feature.geometry.coordinates,
      getColor: () => withAlpha(themeColors.highlight, 255)
    });
    const circlePointLayer = new ScatterplotLayer<MapPointDatum>({
      id: "tangram-navaid-circle-points",
      data: circlePoints,
      pickable: true,
      stroked: true,
      parameters: { depthCompare: "always", depthWriteEnabled: false },
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      getRadius: pointMarkerRadius,
      getPosition: datum => datum.position,
      getFillColor: datum =>
        withAlpha(themeColors.point, datumAlpha(datum, relevantActiveId)),
      getLineColor: datum => withAlpha(themeColors.casing, casingAlpha(datum, relevantActiveId)),
      getLineWidth: 1,
      onHover: handlePointHover
    });
    const triangleCasingLayer = new IconLayer<MapPointDatum>({
      id: "tangram-navaid-triangle-casing",
      data: trianglePoints,
      billboard: true,
      parameters: { depthCompare: "always", depthWriteEnabled: false },
      sizeUnits: "pixels",
      getIcon: () => TRIANGLE_ICON,
      getSize: datum => triangleMarkerSize(datum) + TRIANGLE_CASING_PIXELS,
      getPosition: datum => datum.position,
      getColor: datum => withAlpha(themeColors.casing, casingAlpha(datum, relevantActiveId))
    });
    const trianglePointLayer = new IconLayer<MapPointDatum>({
      id: "tangram-navaid-triangle-points",
      data: trianglePoints,
      pickable: true,
      billboard: true,
      parameters: { depthCompare: "always", depthWriteEnabled: false },
      sizeUnits: "pixels",
      getIcon: () => TRIANGLE_ICON,
      getSize: triangleMarkerSize,
      getPosition: datum => datum.position,
      getColor: datum =>
        withAlpha(themeColors.point, datumAlpha(datum, relevantActiveId)),
      onHover: handlePointHover
    });
    const activeCirclePointLayer = new ScatterplotLayer<MapPointDatum>({
      id: "tangram-navaid-active-circle-points",
      data: activeCirclePoints,
      parameters: { depthCompare: "always", depthWriteEnabled: false },
      radiusUnits: "pixels",
      getRadius: activePointRadius,
      getPosition: datum => datum.position,
      getFillColor: () => withAlpha(themeColors.highlight, 255)
    });
    const activeTrianglePointLayer = new IconLayer<MapPointDatum>({
      id: "tangram-navaid-active-triangle-points",
      data: activeTrianglePoints,
      billboard: true,
      parameters: { depthCompare: "always", depthWriteEnabled: false },
      sizeUnits: "pixels",
      getIcon: () => TRIANGLE_ICON,
      getSize: activeTriangleSize,
      getPosition: datum => datum.position,
      getColor: () => withAlpha(themeColors.highlight, 255)
    });

    // registration order is draw order within a slot
    // put highlighting beneath the static elements
    setLayer(routeCasingLayer, "routes");
    setLayer(activeSegmentLayer, "routes");
    setLayer(segmentLayer, "routes");
    setLayer(dashedLayer, "routes");
    setLayer(activeCirclePointLayer, "highlights");
    setLayer(activeTrianglePointLayer, "highlights");
    setLayer(circlePointLayer, "highlights");
    setLayer(triangleCasingLayer, "highlights");
    setLayer(trianglePointLayer, "highlights");
  },
  { immediate: true }
);

watch(
  () => api.map.map.value,
  (map, _previous, onCleanup) => {
    if (!map) return;
    const container = map.getCanvasContainer();
    container.addEventListener("pointerleave", clearMapHover);
    onCleanup(() => container.removeEventListener("pointerleave", clearMapHover));
  },
  { immediate: true }
);

onMounted(() => {
  void refreshThemeColors();
  themeObserver = new MutationObserver(() => void refreshThemeColors());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"]
  });
});

onUnmounted(() => {
  themeObserver?.disconnect();
  clearMapHover();
  for (const handle of layerHandles.values()) handle.dispose();
  layerHandles.clear();
});
</script>

<style scoped>
.color-probes {
  position: fixed;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.route-probe,
.point-probe {
  color: color-mix(in oklch, var(--t-accent1) 90%, var(--t-fg));
}

.casing-probe {
  color: color-mix(in oklch, var(--t-fg) 55%, var(--t-bg));
}

.warning-probe {
  color: color-mix(in oklch, var(--t-error) 86%, var(--t-fg));
}

.highlight-probe {
  color: color-mix(in oklch, var(--t-fg) 88%, var(--t-bg));
}

.deck-tooltip {
  position: fixed;
  z-index: 2000;
  min-width: 120px;
  transform: translate(10px, -20px);
  border: 1px solid var(--t-border);
  border-radius: 10px;
  background: var(--t-bg);
  color: var(--t-fg);
  padding: 4px 8px;
  pointer-events: none;
  font-family: "B612", sans-serif;
  font-size: 11px;
}

.tooltip-grid {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.5rem;
  min-width: 120px;
}

.tooltip-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 1.1em;
  font-weight: 700;
}

.tooltip-warning {
  width: 11px;
  color: color-mix(in oklch, var(--token-hue, var(--t-error)) 64%, var(--t-fg));
  height: 11px;
}

.tooltip-type,
.tooltip-right {
  text-align: right;
}

.tooltip-type,
.tooltip-subtitle,
.tooltip-warning-detail {
  color: var(--t-muted);
}

.tooltip-subtitle,
.tooltip-warning-detail,
.tooltip-row-wide {
  grid-column: 1 / -1;
}

.tooltip-subtitle,
.tooltip-warning-detail {
  margin-block: 1px 2px;
}
</style>
