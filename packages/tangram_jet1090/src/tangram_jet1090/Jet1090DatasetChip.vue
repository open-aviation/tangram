<template>
  <div class="dataset-chip">
    <span class="dataset-stats">
      {{ importedAircraftFlightCount(dataset.payload) }} flights ·
      {{ importedAircraftRecordCount(dataset.payload) }} records
    </span>
  </div>
</template>

<script setup lang="ts">
import type { Jet1090ImportedHistoryEntry } from "./imported_trajectory";
import {
  importedAircraftFlightCount,
  importedAircraftRecordCount
} from "./imported_trajectory";

defineProps<{ dataset: Jet1090ImportedHistoryEntry }>();
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
