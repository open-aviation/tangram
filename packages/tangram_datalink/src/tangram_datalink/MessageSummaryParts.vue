<template>
  <span v-if="parts.length" class="summary-inline">
    <span v-for="(part, idx) in parts" :key="idx" class="summary-part">
      {{ part }}
    </span>
  </span>
</template>

<script setup lang="ts">
defineProps<{ parts: string[] }>();
</script>

<style scoped>
.summary-inline {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: inherit;
}
.summary-part {
  color: var(--t-fg);
  white-space: inherit;
}
.summary-part + .summary-part::before {
  color: var(--t-muted);
  content: "·";
  margin: 0 5px;
}
</style>
