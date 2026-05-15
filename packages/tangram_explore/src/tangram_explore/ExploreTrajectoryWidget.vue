<template>
  <div class="trajectory-list">
    <div v-for="item in selectedTrajectories" :key="item.key" class="trajectory-card">
      <div class="trajectory-header">
        <span class="trajectory-layer">{{ item.state.layerLabel }}</span>
        <span class="trajectory-id">{{ item.state.trajectoryId }}</span>
      </div>
      <div class="trajectory-grid">
        <template v-for="(val, key) in item.state.properties" :key="key">
          <div class="trajectory-key">{{ key }}</div>
          <div class="trajectory-value">
            {{
              typeof val === "number" && !Number.isInteger(val) ? val.toFixed(4) : val
            }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedTrajectory } from "./trajectory_selection";

const selectedTrajectories = computed(() => {
  return selectedTrajectory.value
    ? [
        {
          key: `${selectedTrajectory.value.entryId}:${selectedTrajectory.value.trajectoryId}`,
          state: selectedTrajectory.value
        }
      ]
    : [];
});
</script>

<style scoped>
.trajectory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trajectory-card {
  border: 1px solid var(--t-border);
  border-radius: 8px;
  background: var(--t-bg);
  overflow: hidden;
}

.trajectory-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--t-border);
  background: color-mix(in oklch, var(--t-surface), var(--t-bg) 35%);
}

.trajectory-layer {
  font-weight: 700;
}

.trajectory-id {
  font-family: "Inconsolata", monospace;
  color: var(--t-muted);
}

.trajectory-grid {
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 12px;
  row-gap: 2px;
  padding: 8px 10px;
}

.trajectory-key {
  text-align: right;
  color: var(--t-muted);
}

.trajectory-value {
  word-break: break-word;
}
</style>
