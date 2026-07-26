<template>
  <div class="token-strip">
    <span
      v-for="token in presentation.tokens"
      :key="`${token.index}-${token.label}`"
      class="token"
      :class="[
        `navaid-token-${token.category}`,
        {
          'is-active': isTokenHighlighted(token.index),
          'is-frameable': isFrameable(token)
        }
      ]"
      :tabindex="
        entryId &&
        (token.pointIndices.length ||
          token.segmentIndices.length ||
          token.warnings.length)
          ? 0
          : undefined
      "
      @mouseenter="setTokenSource('pointer', token, $event)"
      @mouseleave="clearTokenSource('pointer', token)"
      @focus="setTokenSource('focus', token, $event)"
      @blur="clearTokenSource('focus', token)"
      @click="activateToken(token, $event)"
      @keydown.enter.space.prevent="activateToken(token, $event)"
    >
      <span>{{ token.label }}</span>
      <SvgIcon
        v-if="token.warnings.length"
        class="warning-icon"
        :path="ICON_PATHS.warning"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from "vue";
import type { Field15Element } from "traffic.js";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { NavaidPoint, type ResolvedRoute } from "./datasets";
import { SvgIcon } from "@open-aviation/tangram-core/components";
import { ICON_PATHS } from "@open-aviation/tangram-core/utils";
import { Field15Presentation, type Field15Token } from "./field15Tokens";
import {
  NavaidTooltip,
  type NavaidInteraction,
  type NavaidInteractionClaim
} from "./interaction";

const props = withDefaults(
  defineProps<{
    elements: Field15Element[];
    entryId?: string;
    route?: ResolvedRoute | null;
    resolutionError?: string | null;
    interaction?: NavaidInteraction;
  }>(),
  {
    entryId: undefined,
    route: null,
    resolutionError: null,
    interaction: undefined
  }
);

const api = inject<TangramApi>("tangramApi")!;
const presentation = computed(
  () =>
    props.route?.presentation ??
    Field15Presentation.fromElements(props.elements, null, props.resolutionError)
);

function isTokenHighlighted(index: number): boolean {
  const target = props.interaction?.state.hover?.target;
  return (
    !!target && target.entryId === props.entryId && target.tokenIndices.includes(index)
  );
}

function routeDatumKeys(kind: "point" | "segment", indices: number[]): string[] {
  return indices.map(index => `${props.entryId}:${kind}:${index}`);
}

function firstRoutePoint(token: Field15Token) {
  const index = token.pointIndices[0];
  return index === undefined ? null : (props.route?.geometry.point(index) ?? null);
}

function firstRouteLeg(token: Field15Token) {
  const index = token.segmentIndices[0];
  return index === undefined ? null : (props.route?.geometry.leg(index) ?? null);
}

type TokenSource = "pointer" | "focus";
type ActiveTokenSource = { index: number; element: HTMLElement };

let hoveredToken: ActiveTokenSource | null = null;
let focusedToken: ActiveTokenSource | null = null;
let interactionClaim: NavaidInteractionClaim | null = null;

function tooltipAnchor(element: HTMLElement): [number, number] {
  const bounds = element.getBoundingClientRect();
  return [bounds.right, bounds.top];
}

function releaseTokenHover(): void {
  if (interactionClaim && props.interaction) {
    props.interaction.releaseHover(interactionClaim);
  }
  interactionClaim = null;
}

function showToken({ index, element }: ActiveTokenSource): boolean {
  if (!props.entryId || !props.interaction) return false;
  const token = presentation.value.tokens[index];
  if (!token) return false;
  if (
    token.pointIndices.length === 0 &&
    token.segmentIndices.length === 0 &&
    token.warnings.length === 0
  ) {
    return false;
  }

  const point = firstRoutePoint(token);
  const leg = firstRouteLeg(token);
  const tooltip = point
    ? NavaidTooltip.fromPoint(
        NavaidPoint.fromFeature(point),
        token.warnings,
        token.warnings.length ? token.category : undefined
      )
    : leg
      ? NavaidTooltip.fromLeg(
          leg,
          token.type,
          token.warnings,
          token.warnings.length ? token.category : undefined
        )
      : token.warnings.length
        ? NavaidTooltip.fromWarnings(
            token.label,
            token.type,
            token.warnings,
            token.category
          )
        : null;
  if (!tooltip) return false;

  releaseTokenHover();
  const [x, y] = tooltipAnchor(element);
  interactionClaim = props.interaction.claimHover(
    {
      entryId: props.entryId,
      tokenIndices: [token.index],
      pointKeys: routeDatumKeys("point", token.pointIndices),
      segmentKeys: routeDatumKeys("segment", token.segmentIndices)
    },
    tooltip,
    x,
    y
  );
  return true;
}

function syncTokenHover(): void {
  const active = hoveredToken ?? focusedToken;
  if (active && showToken(active)) return;
  releaseTokenHover();
}

function setTokenSource(source: TokenSource, token: Field15Token, event: Event): void {
  const active = { index: token.index, element: event.currentTarget as HTMLElement };
  if (source === "pointer") hoveredToken = active;
  else focusedToken = active;
  syncTokenHover();
}

function clearTokenSource(source: TokenSource, token: Field15Token): void {
  if (source === "pointer" && hoveredToken?.index === token.index) {
    hoveredToken = null;
  } else if (source === "focus" && focusedToken?.index === token.index) {
    focusedToken = null;
  }
  syncTokenHover();
}

function isFrameable(token: Field15Token): boolean {
  return (
    !!props.route && (token.pointIndices.length > 0 || token.segmentIndices.length > 0)
  );
}

function frameToken(token: Field15Token): void {
  if (!isFrameable(token) || !props.route) return;
  const bounds = props.route.geometry.subsetBounds(
    token.pointIndices,
    token.segmentIndices
  );
  if (!bounds) return;

  const map = api.map.getMapInstance();
  if (bounds.minLon === bounds.maxLon && bounds.minLat === bounds.maxLat) {
    map.flyTo({
      center: [bounds.minLon, bounds.minLat],
      zoom: Math.max(map.getZoom(), 9),
      speed: 1.2
    });
  } else {
    map.fitBounds(
      [
        [bounds.minLon, bounds.minLat],
        [bounds.maxLon, bounds.maxLat]
      ],
      { padding: 80, maxZoom: 10 }
    );
  }
}

function activateToken(token: Field15Token, event: Event): void {
  if (!isFrameable(token)) return;
  event.stopPropagation();
  frameToken(token);
}

watch(presentation, syncTokenHover);
onUnmounted(releaseTokenHover);
</script>

<style scoped>
.token-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
}

:global(.navaid-token-speed-level) {
  --token-hue: color-mix(in oklch, var(--t-accent1) 82%, oklch(0.72 0.13 250));
}

:global(.navaid-token-procedure) {
  --token-hue: color-mix(in oklch, var(--t-accent1) 42%, oklch(0.72 0.15 305));
}

:global(.navaid-token-point) {
  --token-hue: color-mix(in oklch, var(--t-accent2) 76%, oklch(0.72 0.13 150));
}

:global(.navaid-token-direct) {
  --token-hue: color-mix(in oklch, var(--t-muted) 78%, var(--t-fg));
}

:global(.navaid-token-airway) {
  --token-hue: color-mix(in oklch, var(--t-accent2) 36%, oklch(0.76 0.14 75));
}

:global(.navaid-token-track) {
  --token-hue: color-mix(in oklch, var(--t-error) 45%, oklch(0.7 0.15 25));
}

:global(.navaid-token-flag) {
  --token-hue: color-mix(in oklch, var(--t-muted) 72%, var(--t-fg));
}

.token {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid
    color-mix(in oklch, var(--token-hue, var(--t-muted)) 48%, var(--t-border));
  border-radius: 4px;
  background: color-mix(in oklch, var(--token-hue, var(--t-muted)) 13%, var(--t-bg));
  color: color-mix(in oklch, var(--token-hue, var(--t-muted)) 64%, var(--t-fg));
  padding: 1px 4px;
  outline: 2px solid transparent;
  outline-offset: 1px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.4;
  transition:
    background-color 0.12s,
    border-color 0.12s,
    outline-color 0.12s;
}

.token:hover,
.token:focus-visible {
  background: color-mix(in oklch, var(--token-hue, var(--t-muted)) 21%, var(--t-bg));
}

.token.is-active {
  outline-color: color-mix(in oklch, var(--t-accent1) 78%, var(--t-fg));
}

.token.is-frameable {
  cursor: zoom-in;
}

.warning-icon {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
}
</style>
