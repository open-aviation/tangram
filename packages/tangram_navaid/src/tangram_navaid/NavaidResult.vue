<template>
  <div>
    <div class="row">
      <span class="ident">
        <HighlightText :parts="identParts" />
      </span>
      <div class="chips">
        <span class="chip kind" :class="isFix ? 'fix' : 'navaid'">{{ kindLabel }}</span>
        <span v-if="point.frequency !== null" class="chip mono">
          {{ point.frequency }}
        </span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :parts="nameParts" />
      <span class="coords"> · {{ coords }}</span>
      <span v-if="point.source" class="source"> · {{ point.source }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { HighlightText } from "@open-aviation/tangram-core/components";
import type { NavaidPoint } from "./datasets";

interface HighlightPart {
  text: string;
  matched: boolean;
}

const props = defineProps<{
  point: NavaidPoint;
  identParts: HighlightPart[];
  nameParts: HighlightPart[];
}>();

const isFix = computed(() => props.point.kind.toLowerCase() === "fix");
const kindLabel = computed(() =>
  isFix.value ? "FIX" : props.point.kind.toUpperCase()
);
const coords = computed(() => {
  const northSouth = props.point.latitude >= 0 ? "N" : "S";
  const eastWest = props.point.longitude >= 0 ? "E" : "W";
  return `${Math.abs(props.point.latitude).toFixed(4)}°${northSouth} ${Math.abs(
    props.point.longitude
  ).toFixed(4)}°${eastWest}`;
});
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--t-fg);
}

.ident {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  font-weight: 600;
}

.subtitle {
  color: var(--t-muted);
  font-size: 12px;
}

.coords,
.source {
  opacity: 0.8;
}

.chips {
  display: flex;
  gap: 4px;
}

.chip {
  border: 1px solid color-mix(in oklch, var(--chip-color) 48%, var(--t-border));
  border-radius: 4px;
  background: color-mix(in oklch, var(--chip-color) 14%, var(--t-bg));
  color: color-mix(in oklch, var(--chip-color) 64%, var(--t-fg));
  padding: 0 4px;
  font-size: 11px;
}

.kind.navaid {
  --chip-color: var(--t-accent1);
}

.kind.fix {
  --chip-color: var(--t-accent2);
}

.mono {
  --chip-color: var(--t-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
