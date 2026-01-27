<template>
  <div class="flight-interval">
    <div class="times">
      <span>{{ formatTime(startTs) }}</span>
      <span class="arrow"> - </span>
      <span>{{ formatTime(endTs) }}</span>
    </div>
    <div class="duration">{{ formatDuration(duration) }}</div>
  </div>
</template>

<script setup lang="ts">
import { formatTime, formatDuration } from "@open-aviation/tangram-core/utils";

defineProps<{
  startTs: string;
  endTs: string;
  duration: number;
}>();
</script>

<style scoped>
.flight-interval {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.duration {
  color: #666;
}
</style>
