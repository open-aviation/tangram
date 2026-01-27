<template>
  <div class="airport-result">
    <div class="row">
      <span class="name">
        <HighlightText :text="name" :query="query" />
      </span>
      <div class="chips">
        <span class="chip blue">
          <HighlightText :text="iata" :query="query" />
        </span>
        <span class="chip yellow">
          <HighlightText :text="icao" :query="query" />
        </span>
      </div>
    </div>
    <div class="subtitle">
      <HighlightText :text="city" :query="query" />, {{ countryCode }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  name: string;
  city: string;
  countryCode: string;
  iata: string;
  icao: string;
  query: string;
}>();
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--t-fg);
}
.name {
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
