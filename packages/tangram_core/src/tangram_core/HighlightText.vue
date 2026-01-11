<template>
  <span>
    <span v-for="(p, i) in parts" :key="i" :class="{ highlight: p.m }">{{ p.t }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  text: string;
  query: string;
}>();

const parts = computed(() => {
  if (!props.query || !props.text) return [{ t: props.text, m: false }];
  const escapedQuery = props.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r = new RegExp(`(${escapedQuery})`, "gi");
  return props.text
    .split(r)
    .map(t => ({ t, m: t.toLowerCase() === props.query.toLowerCase() }))
    .filter(x => x.t);
});
</script>

<style scoped>
.highlight {
  font-weight: 800;
  background: rgba(255, 255, 0, 0.2);
  color: inherit;
}
</style>
