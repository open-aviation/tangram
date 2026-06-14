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
import type { SummaryRow } from "./summary_rows";

defineProps<{
  rows: SummaryRow[];
  empty: string;
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
  align-items: baseline;
}
.summary-meta {
  color: var(--t-muted);
  font-family: "Inconsolata", monospace;
  font-size: 0.92em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
