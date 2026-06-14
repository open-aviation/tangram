<template>
  <span class="message-category-chip" :class="`cat-${category}`"
    ><span>{{ label }}</span></span
  >
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
  display: inline-flex;
  max-width: min(20rem, 100%);
  height: 17px;
  align-items: center;
  border: 1px solid var(--cat-border);
  border-radius: 4px;
  background: var(--cat-bg);
  color: var(--cat-fg);
  font-family: "Inconsolata", monospace;
  font-size: 0.8em;
  font-weight: 700;
  line-height: 1;
  padding: 1px 4px 0;
  box-sizing: border-box;
  vertical-align: middle;
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
