<template>
  <div
    ref="rootRef"
    class="message-item"
    :data-feed-index="row.index"
    tabindex="-1"
    @mouseenter="$emit('preview', row.key)"
    @mouseleave="$emit('clearPreview', row.key)"
    @focus="$emit('preview', row.key)"
    @click.stop="$emit('toggle', row.key)"
  >
    <div class="message-header">
      <span class="time">{{ formatTime(row.msg.timestamp) }}</span>
      <MessageCategoryChip :category="row.category" :label="row.categoryLabel" />
    </div>
    <component
      :is="row.summaryComponent"
      v-if="row.summaryComponent"
      class="feed-summary"
      :msg="row.msg"
    />
    <div v-if="row.text" class="raw-text feed-text">
      {{ row.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, type Component } from "vue";
import type { MessageCategoryId } from "./store";
import type { DatalinkMessage } from "./types";
import MessageCategoryChip from "./MessageCategoryChip.vue";

export type DatalinkFeedRowModel = {
  entityId: string;
  key: string;
  index: number;
  msg: DatalinkMessage;
  category: MessageCategoryId;
  categoryLabel: string;
  summaryComponent?: Component;
  text?: string;
};

const props = defineProps<{ row: DatalinkFeedRowModel }>();
const emit = defineEmits<{
  register: [key: string, element: HTMLElement | null];
  preview: [key: string];
  clearPreview: [key: string];
  toggle: [key: string];
}>();

const rootRef = ref<HTMLElement | null>(null);

const formatTime = (ts: number | null | undefined) => {
  if (!ts) return "N/A";
  return new Date(ts * 1000).toISOString().substring(11, 19) + "Z";
};

const register = () => emit("register", props.row.key, rootRef.value);

onMounted(register);
onUpdated(register);
onBeforeUnmount(() => emit("register", props.row.key, null));
</script>

<style scoped>
.message-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: 6px;
  padding: 4px 5px;
  cursor: pointer;
  outline: none;
}
.message-item:hover,
.message-item.active {
  background: var(--t-hover);
  box-shadow: inset 0 0 0 1px var(--t-border);
}
.message-item.focused {
  box-shadow: inset 0 0 0 1px var(--t-accent1);
}
.message-header {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 0.88em;
}
.time {
  color: var(--t-fg);
  font-family: "Inconsolata", monospace;
  font-weight: 600;
}
.feed-summary {
  color: var(--t-fg);
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.raw-text {
  font-family: "Inconsolata", monospace;
  font-size: 0.85em;
  color: var(--t-fg);
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 4px;
}
.feed-text {
  color: color-mix(in oklch, var(--t-fg) 72%, var(--t-muted));
  line-height: 1.45;
  margin-top: 0;
}
</style>
