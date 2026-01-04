<template>
  <div class="ship-interval">
    <div class="times">
      <span>{{ formatTime(start_ts) }}</span>
      <span class="arrow"> - </span>
      <span>{{ formatTime(end_ts) }}</span>
    </div>
    <div class="duration">{{ formatDuration(duration) }}</div>
  </div>
</template>

<script setup lang="ts">
import { formatTime, formatDuration } from "@open-aviation/tangram-core/utils";

defineProps<{
  start_ts: string;
  end_ts: string;
  duration: number;
}>();
</script>

<style scoped>
.ship-interval {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.duration {
  color: #666;
}
</style>
