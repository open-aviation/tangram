<!-- TODO we migrated away from recursive rendering for now, which looks ugly
but so we might want to revisit later -->
<template>
  <pre class="tree-view">{{ text }}</pre>
</template>

<script setup lang="ts">
import { shallowRef, toRaw, watch } from "vue";

const props = withDefaults(
  defineProps<{
    data: unknown;
    maxRows?: number;
  }>(),
  { maxRows: 800 }
);

type Frame = {
  value: unknown;
  depth: number;
  label: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const primitiveValue = (value: unknown) => {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return String(value);
};

const rowText = (depth: number, label: string, value: string) => {
  const indent = "  ".repeat(depth);
  return label ? `${indent}${label}: ${value}` : `${indent}${value}`;
};

const flattenTree = (data: unknown, maxRows: number) => {
  const lines: string[] = [];
  const stack: Frame[] = [{ value: toRaw(data), depth: 0, label: "" }];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    if (lines.length >= maxRows) {
      lines.push(`truncated after ${maxRows} rows`);
      break;
    }

    const frame = stack.pop()!;
    const value = toRaw(frame.value);

    if (Array.isArray(value)) {
      if (frame.label || value.length === 0) {
        lines.push(rowText(frame.depth, frame.label, value.length === 0 ? "[]" : ""));
      }

      if (seen.has(value)) {
        lines.push(rowText(frame.depth + 1, "", "[circular]"));
        continue;
      }
      seen.add(value);

      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({
          value: value[i],
          depth: frame.label ? frame.depth + 1 : frame.depth,
          label: `[${i}]`
        });
      }
      continue;
    }

    if (isRecord(value)) {
      const entries = Object.entries(value);
      if (frame.label || entries.length === 0) {
        lines.push(rowText(frame.depth, frame.label, entries.length === 0 ? "{}" : ""));
      }

      if (seen.has(value)) {
        lines.push(rowText(frame.depth + 1, "", "[circular]"));
        continue;
      }
      seen.add(value);

      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i];
        stack.push({
          value: child,
          depth: frame.label ? frame.depth + 1 : frame.depth,
          label: key
        });
      }
      continue;
    }

    lines.push(rowText(frame.depth, frame.label, primitiveValue(value)));
  }

  return lines.join("\n");
};

const text = shallowRef("");

watch(
  () => [props.data, props.maxRows] as const,
  ([data, maxRows]) => {
    text.value = flattenTree(data, maxRows);
  },
  { immediate: true }
);
</script>

<style scoped>
.tree-view {
  margin: 0;
  font-family: "Inconsolata", monospace;
  font-size: 0.9em;
  line-height: 1.3;
  color: var(--t-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
