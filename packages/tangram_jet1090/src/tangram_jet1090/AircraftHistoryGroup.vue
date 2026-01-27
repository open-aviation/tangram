<template>
  <div class="flight-group">
    <div class="row">
      <span class="callsign">
        <HighlightText :text="callsign" :query="query" />
      </span>
      <span class="icao24">0x<HighlightText :text="icao24" :query="query" /> </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  callsign: string;
  icao24: string;
  query: string;
}>();
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  font-weight: 500;
  font-size: 14px;
  color: var(--t-fg);
}
.icao24 {
  font-family: monospace;
  background: var(--t-accent2);
  color: var(--t-accent2-fg);
  padding: 0 4px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
