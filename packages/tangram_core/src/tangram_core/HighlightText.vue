<template>
  <span>
    <span
      v-for="(part, index) in parts"
      :key="index"
      :class="{ highlight: part.matched }"
      >{{ part.text }}</span
    >
  </span>
</template>

<script setup lang="ts">
import type { HighlightTextPart } from "./utils";

defineProps<{ parts: readonly HighlightTextPart[] }>();
</script>

<style scoped>
.highlight {
  font-weight: 800;
  background: rgba(255, 255, 0, 0.2);
  color: inherit;
}
</style>
