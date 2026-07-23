<template>
  <div class="nav-result">
    <div class="row">
      <span class="ident">
        <HighlightText :text="ident" :query="query" />
      </span>
      <div class="chips">
        <span class="chip" :class="chipClass">{{ kindLabel }}</span>
        <span v-if="frequency" class="chip mono">{{ frequency }}</span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :text="name || ident" :query="query" />
      <span class="coords"> · {{ coords }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { HighlightText } from "@open-aviation/tangram-core/components";

const props = defineProps<{
  ident: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  frequency?: number | null;
  query: string;
}>();

const isFix = computed(() => props.kind?.toLowerCase() === "fix");
const chipClass = computed(() => (isFix.value ? "green" : "blue"));
const kindLabel = computed(() =>
  isFix.value ? "FIX" : (props.kind || "NAVAID").toUpperCase()
);

const coords = computed(() => {
  const ns = props.lat >= 0 ? "N" : "S";
  const ew = props.lon >= 0 ? "E" : "W";
  return `${Math.abs(props.lat).toFixed(4)}°${ns} ${Math.abs(props.lon).toFixed(4)}°${ew}`;
});
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--t-fg);
}
.ident {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  font-size: 14px;
}
.subtitle {
  font-size: 12px;
  color: var(--t-muted);
}
.coords {
  opacity: 0.8;
}
.chips {
  display: flex;
  gap: 4px;
}
.chip {
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--t-hover);
  color: var(--t-fg);
}
.blue {
  background: var(--t-accent1);
  color: var(--t-accent1-fg);
}
.green {
  background: var(--t-accent2);
  color: var(--t-accent2-fg);
}
</style>
