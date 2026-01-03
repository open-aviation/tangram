<template>
  <div class="flight-interval">
    <div class="times">
      <span>{{ formatTime(start_ts) }}</span>
      <span class="arrow"> - </span>
      <span>{{ formatTime(end_ts) }}</span>
    </div>
    <div class="duration">{{ formatDuration(duration) }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  start_ts: string;
  end_ts: string;
  duration: number;
}>();

const formatTime = (ts: string) => {
  const d = new Date(ts + "Z");
  return (
    d.toLocaleString("en-GB", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) + "Z"
  );
};

const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
};
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
