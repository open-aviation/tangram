<template>
  <div class="ship-result">
    <div class="row">
      <span class="name">
        <HighlightText :text="name || 'Unknown'" :query="query" />
      </span>
      <div class="chips">
        <span class="chip blue">{{ type || "?" }}</span>
        <span class="chip yellow">
          <HighlightText :text="mmsi" :query="query" />
        </span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :text="callsign || 'N/A'" :query="query" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  name?: string;
  mmsi: string;
  callsign?: string;
  type?: string;
  query: string;
}>();
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.name {
  font-weight: 500;
  font-size: 14px;
}
.subtitle {
  font-size: 12px;
  color: #666;
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
  background: #4c78a8;
  color: white;
}
.yellow {
  background: #f2cf5b;
  color: black;
}
</style>
