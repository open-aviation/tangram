<template>
  <div class="ship-group">
    <div class="row">
      <span class="name">
        <HighlightText :text="name || 'Unknown'" :query="query" />
      </span>
      <span class="mmsi"> <HighlightText :text="mmsi" :query="query" /> </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  name: string;
  mmsi: string;
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
.mmsi {
  font-family: monospace;
  background: var(--t-accent2);
  color: var(--t-accent2-fg);
  padding: 0 4px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
