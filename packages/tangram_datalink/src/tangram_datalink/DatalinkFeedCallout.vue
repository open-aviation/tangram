<template>
  <div
    class="feed-callout-hitbox"
    :style="hitboxStyle"
    @mouseenter="$emit('keepOpen')"
    @mouseleave="$emit('scheduleClose')"
  >
    <div class="feed-callout-bridge" :style="bridgeStyle" />
    <div class="feed-callout" :style="panelStyle">
      <button
        v-if="pinned"
        class="callout-close"
        type="button"
        @click.stop="$emit('clear')"
      >
        ×
      </button>
      <TreeView
        v-if="treeKey === activeKey"
        :data="rawMessage(row.msg).message"
        :max-rows="900"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import type { DatalinkFeedRowModel } from "./DatalinkFeedRow.vue";
import TreeView from "./TreeView.vue";
import { rawMessage } from "./summary_helpers";

defineProps<{
  row: DatalinkFeedRowModel;
  activeKey: string | null;
  treeKey: string | null;
  pinned: boolean;
  hitboxStyle: CSSProperties;
  bridgeStyle: CSSProperties;
  panelStyle: CSSProperties;
}>();

defineEmits<{
  keepOpen: [];
  scheduleClose: [];
  clear: [];
}>();
</script>

<style scoped>
.feed-callout-hitbox {
  position: fixed;
  z-index: 4000;
  display: flex;
  align-items: stretch;
  pointer-events: none;
}
.feed-callout-bridge {
  flex: 0 0 auto;
  pointer-events: auto;
}
.feed-callout {
  position: relative;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--t-border);
  border-radius: 9px;
  background: var(--t-surface);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  color: var(--t-fg);
  pointer-events: auto;
}
.callout-close {
  position: sticky;
  top: 0;
  float: right;
  margin-left: 8px;
  border: none;
  background: transparent;
  color: var(--t-muted);
  cursor: pointer;
  font-family: "Inconsolata", monospace;
  font-size: 1.35rem;
  line-height: 1;
  padding: 0 2px;
}
.callout-close:hover {
  color: var(--t-fg);
}
</style>
