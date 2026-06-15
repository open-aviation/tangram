<template>
  <div v-if="rows.length" class="summary-rows">
    <div v-for="(row, idx) in rows" :key="idx" class="summary-row">
      <span class="summary-meta">{{ row.meta }}</span>
      <span class="summary-detail">
        <slot :row="row" :index="idx">{{ row.detail }}</slot>
      </span>
    </div>
  </div>
  <span v-else>{{ empty }}</span>
</template>

<script setup lang="ts">
import type { SummaryRow } from "../types";

defineOptions({ name: "DatalinkSummaryRows" });

defineProps<{
  rows: SummaryRow[];
  empty: string;
}>();

defineSlots<{
  default?: (props: { row: SummaryRow; index: number }) => unknown;
}>();
</script>

<style scoped>
.summary-rows {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  white-space: normal;
}
.summary-row {
  display: grid;
  grid-template-columns: 6.8em minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
  align-items: start;
}
.summary-meta {
  color: var(--t-muted);
  font-family: "Inconsolata", monospace;
  font-size: 1em;
  overflow-wrap: anywhere;
  white-space: normal;
}
.summary-detail {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
