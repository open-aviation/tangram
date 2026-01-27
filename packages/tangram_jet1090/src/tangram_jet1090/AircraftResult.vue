<template>
  <div class="aircraft-result">
    <div class="row">
      <span class="reg">
        <HighlightText :text="registration || icao24" :query="query" />
      </span>
      <div class="chips">
        <span class="chip blue">{{ typecode || "?" }}</span>
        <span class="chip yellow">
          0x<HighlightText :text="icao24" :query="query" />
        </span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :text="callsign || 'N/A'" :query="query" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  registration?: string;
  icao24: string;
  callsign?: string;
  typecode?: string;
  query: string;
}>();
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--t-fg);
}
.reg {
  font-weight: 500;
  font-size: 14px;
}
.subtitle {
  font-size: 12px;
  color: var(--t-muted);
}
.chips {
  display: flex;
  gap: 4px;
}
.chip {
  border-radius: 4px;
  padding: 0 4px;
  font-family: monospace;
  font-size: 11px;
}
.blue {
  background: var(--t-accent1);
  color: var(--t-accent1-fg);
}
.yellow {
  background: var(--t-accent2);
  color: var(--t-accent2-fg);
}
</style>
