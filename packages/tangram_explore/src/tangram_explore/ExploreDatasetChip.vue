<template>
  <div class="dataset-chip">
    <div
      class="status-dot"
      :style="{ backgroundColor: getLayerColor(entry.style) }"
    ></div>
    <span class="dataset-stats">{{ getLayerStats(entry) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceDatasetEntry } from "@open-aviation/tangram-core/api";
import { parseColorSpec } from "@open-aviation/tangram-core/utils";
import type { ExploreDatasetEntry, ExploreStyleOptions } from "./datasets";

const props = defineProps<{ dataset: WorkspaceDatasetEntry }>();
const entry = computed(() => props.dataset as ExploreDatasetEntry);

function getLayerColor(style: ExploreStyleOptions): string {
  const color = style.kind === "trajectory" ? style.line_color : style.fill_color;
  const [r, g, b, a] = parseColorSpec(color) ?? [128, 128, 128, 255];
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function getLayerStats(layer: ExploreDatasetEntry): string {
  if (layer.kind === "table") {
    return `${layer.payload.stats.rowCount.toLocaleString()} rows`;
  }

  if (layer.kind === "trajectories") {
    return `${layer.payload.stats.trajectoryCount.toLocaleString()} trajectories`;
  }

  return `${layer.payload.stats.featureCount.toLocaleString()} features`;
}
</script>

<style scoped>
.dataset-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dataset-stats {
  color: var(--t-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
}
</style>
