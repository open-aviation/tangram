<template>
  <div class="aircraft-result">
    <div class="row">
      <span class="reg">
        <HighlightText :text="registration || icao24" :query="query" />
      </span>
      <div class="chips">
        <span class="chip blue">{{ typecode || "?" }}</span>
        <span class="chip yellow">
          0x<HighlightText :text="icao24" :query="query" />
        </span>
      </div>
    </div>
    <div class="subtitle">
      Callsign:
      <HighlightText :text="callsign || 'N/A'" :query="query" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  registration?: string;
  icao24: string;
  callsign?: string;
  typecode?: string;
  query: string;
}>();
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.reg {
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
