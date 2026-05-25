<template>
  <div class="dataset-chip">
    <span class="dataset-stats">
      {{ importedShipTrackCount(dataset.payload) }} tracks ·
      {{ importedShipRecordCount(dataset.payload) }} records
    </span>
  </div>
</template>

<script setup lang="ts">
import type { Ship162ImportedHistoryEntry } from "./imported_trajectory";
import { importedShipRecordCount, importedShipTrackCount } from "./imported_trajectory";

defineProps<{ dataset: Ship162ImportedHistoryEntry }>();
</script>

<style scoped>
.dataset-chip {
  display: flex;
  align-items: center;
  padding: 2px 4px;
}

.dataset-stats {
  color: var(--t-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
}
</style>
