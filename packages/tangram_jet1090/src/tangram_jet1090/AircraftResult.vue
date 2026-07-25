<template>
  <div class="aircraft-result">
    <div class="row">
      <span class="reg">
        <HighlightText :parts="registrationParts" />
      </span>
      <div class="chips">
        <span class="chip blue">{{ typecode || "?" }}</span>
        <span class="chip yellow"> 0x<HighlightText :parts="icao24Parts" /> </span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :parts="callsignParts" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";
import type { HighlightTextPart } from "@open-aviation/tangram-core/utils";

defineProps<{
  registrationParts: readonly HighlightTextPart[];
  icao24Parts: readonly HighlightTextPart[];
  callsignParts: readonly HighlightTextPart[];
  typecode?: string;
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
