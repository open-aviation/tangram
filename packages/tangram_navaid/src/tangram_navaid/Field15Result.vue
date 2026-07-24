<template>
  <div class="field15-result">
    <span class="label">{{ label }}</span>
    <div class="subtitle mono">
      <HighlightText :text="expression" :query="query" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HighlightText } from "@open-aviation/tangram-core/components";

defineProps<{
  expression: string;
  label?: string;
  query: string;
}>();
</script>

<style scoped>
.label {
  font-weight: 500;
  font-size: 14px;
  color: var(--t-fg);
}
.subtitle {
  font-size: 12px;
  color: var(--t-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
