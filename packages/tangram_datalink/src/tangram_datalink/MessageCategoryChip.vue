<template>
  <span class="message-category-chip" :class="`cat-${category}`">{{ label }}</span>
</template>

<script setup lang="ts">
import type { MessageCategoryId } from "./store";

defineProps<{
  category: MessageCategoryId;
  label: string;
}>();
</script>

<style scoped>
.message-category-chip {
  --cat-bg: oklch(45% 0.02 260 / 0.34);
  --cat-fg: var(--t-fg);
  border-radius: 5px;
  background: var(--cat-bg);
  color: var(--cat-fg);
  font-family: "Inconsolata", monospace;
  font-size: 0.82em;
  font-weight: 700;
  line-height: 1.15;
  padding: 1px 5px;
  white-space: nowrap;
  word-break: keep-all;
}
.cat-adsc {
  --cat-bg: oklch(47% 0.15 250 / 0.42);
  --cat-fg: oklch(86% 0.07 250);
}
.cat-cpdlc {
  --cat-bg: oklch(47% 0.15 300 / 0.42);
  --cat-fg: oklch(88% 0.07 300);
}
.cat-afn {
  --cat-bg: oklch(48% 0.13 155 / 0.42);
  --cat-fg: oklch(88% 0.08 155);
}
.cat-text {
  --cat-bg: oklch(48% 0.03 250 / 0.42);
  --cat-fg: oklch(88% 0.02 250);
}
.cat-position {
  --cat-bg: oklch(50% 0.13 85 / 0.42);
  --cat-fg: oklch(90% 0.08 85);
}
.cat-aoc,
.cat-oooi {
  --cat-bg: oklch(47% 0.12 35 / 0.42);
  --cat-fg: oklch(88% 0.08 35);
}
.cat-miam,
.cat-xid {
  --cat-bg: oklch(47% 0.1 210 / 0.42);
  --cat-fg: oklch(88% 0.06 210);
}
.cat-other {
  --cat-bg: oklch(43% 0.02 250 / 0.34);
  --cat-fg: var(--t-muted);
}
</style>
