<template>
  <div class="flight-group">
    <div class="row">
      <span class="callsign">
        <HighlightText :parts="callsignParts" />
      </span>
      <span class="icao24">0x<HighlightText :parts="icao24Parts" /> </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";
import type { HighlightTextPart } from "@open-aviation/tangram-core/utils";

defineProps<{
  callsignParts: readonly HighlightTextPart[];
  icao24Parts: readonly HighlightTextPart[];
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
