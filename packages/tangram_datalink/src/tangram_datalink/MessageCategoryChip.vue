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
  --cat-color: color-mix(in oklch, var(--t-muted) 80%, var(--t-fg));
  --cat-bg: color-mix(in oklch, var(--cat-color) 14%, var(--t-bg));
  --cat-border: color-mix(in oklch, var(--cat-color) 38%, var(--t-border));
  --cat-fg: color-mix(in oklch, var(--cat-color) 76%, var(--t-fg));
  border: 1px solid var(--cat-border);
  border-radius: 5px;
  background: var(--cat-bg);
  color: var(--cat-fg);
  font-family: "Inconsolata", monospace;
  font-size: 0.82em;
  font-weight: 700;
  line-height: 1.15;
  padding: 0 5px;
  white-space: nowrap;
  word-break: keep-all;
}
.cat-adsc {
  --cat-color: oklch(54% 0.16 250);
}
.cat-cpdlc {
  --cat-color: oklch(56% 0.15 300);
}
.cat-afn {
  --cat-color: oklch(54% 0.13 155);
}
.cat-text {
  --cat-color: color-mix(in oklch, var(--t-muted) 84%, var(--t-fg));
}
.cat-position {
  --cat-color: oklch(58% 0.14 85);
}
.cat-aoc,
.cat-oooi {
  --cat-color: oklch(55% 0.13 35);
}
.cat-miam,
.cat-xid {
  --cat-color: oklch(56% 0.11 210);
}
.cat-other {
  --cat-color: color-mix(in oklch, var(--t-muted) 70%, var(--t-fg));
  --cat-bg: color-mix(in oklch, var(--t-muted) 10%, var(--t-bg));
  --cat-fg: color-mix(in oklch, var(--t-muted) 80%, var(--t-fg));
}
</style>
