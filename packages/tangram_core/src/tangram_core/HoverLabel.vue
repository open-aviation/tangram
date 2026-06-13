<template>
  <span
    class="hover-label"
    :class="{ 'has-description': hasDescription }"
    :title="description || undefined"
    >{{ label }}</span
  >
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  description?: string | null;
}>();

const hasDescription = computed(() => Boolean(props.description));
</script>

<style scoped>
.hover-label {
  color: inherit;
}

.has-description {
  position: relative;
  display: inline-block;
  cursor: help;
}

.has-description::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background-image: repeating-linear-gradient(
    to right,
    color-mix(in oklch, var(--t-muted) 40%, transparent) 0 2px,
    transparent 2px 7px
  );
  pointer-events: none;
}
</style>
