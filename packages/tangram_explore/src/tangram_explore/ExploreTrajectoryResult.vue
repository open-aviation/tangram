<template>
  <div class="trajectory-result">
    <div class="trajectory-result-header">
      <span class="trajectory-result-id">{{ trajectoryId }}</span>
      <span class="trajectory-result-layer">{{ layerLabel }}</span>
    </div>
    <div v-if="points !== undefined" class="trajectory-result-meta">
      {{ points }} points
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  trajectoryId: string;
  layerLabel: string;
  points?: number;
}>();
</script>

<style scoped>
.trajectory-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trajectory-result-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.trajectory-result-id {
  font-family: "Inconsolata", monospace;
  font-weight: 700;
}

.trajectory-result-layer,
.trajectory-result-meta {
  color: var(--t-muted);
  font-size: 12px;
}
</style>
