<template>
  <div
    class="feed-callout-hitbox"
    :style="hitboxStyle"
    @mouseenter="emit('keepOpen')"
    @mouseleave="onMouseLeave"
    @pointerdown.capture="startInteraction"
  >
    <div class="feed-callout-bridge" :style="bridgeStyle" />
    <div class="feed-callout" :style="panelStyle">
      <div class="callout-actions">
        <IconButton
          :title="copied ? 'copied json' : 'copy json'"
          :aria-label="copied ? 'copied json' : 'copy json'"
          size="xs"
          muted
          @click.stop="copyJson"
        >
          <SvgIcon :path="copied ? ICON_PATHS.check : ICON_PATHS.contentCopy" />
        </IconButton>
        <IconButton
          v-if="pinned"
          title="close"
          aria-label="close"
          size="xs"
          muted
          @click.stop="emit('clear')"
        >
          <SvgIcon :path="ICON_PATHS.close" />
        </IconButton>
      </div>
      <TreeView
        v-if="treeKey === activeKey"
        :data="rawMessage(row.msg).message"
        :max-rows="900"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { CSSProperties } from "vue";
import { IconButton, SvgIcon } from "@open-aviation/tangram-core/components";
import { ICON_PATHS } from "@open-aviation/tangram-core/utils";
import type { DatalinkFeedRowModel } from "./DatalinkFeedRow.vue";
import TreeView from "./TreeView.vue";
import { rawMessage } from "./summary_helpers";

const props = defineProps<{
  row: DatalinkFeedRowModel;
  activeKey: string | null;
  treeKey: string | null;
  pinned: boolean;
  hitboxStyle: CSSProperties;
  bridgeStyle: CSSProperties;
  panelStyle: CSSProperties;
}>();

const emit = defineEmits<{
  keepOpen: [];
  scheduleClose: [];
  clear: [];
  interactionStart: [];
  interactionEnd: [];
}>();

const copied = ref(false);
const isInteracting = ref(false);
const jsonText = computed(() =>
  JSON.stringify(rawMessage(props.row.msg).message, null, 2)
);

const copyViaTextarea = (text: string) => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

const removeInteractionListeners = () => {
  window.removeEventListener("pointerup", endInteraction);
  window.removeEventListener("pointercancel", endInteraction);
};

function endInteraction() {
  removeInteractionListeners();
  if (!isInteracting.value) return;
  isInteracting.value = false;
  emit("interactionEnd");
}

const startInteraction = () => {
  if (isInteracting.value) return;
  isInteracting.value = true;
  emit("interactionStart");
  emit("keepOpen");
  window.addEventListener("pointerup", endInteraction, { once: true });
  window.addEventListener("pointercancel", endInteraction, { once: true });
};

const onMouseLeave = () => {
  if (isInteracting.value) return;
  emit("scheduleClose");
};

const copyJson = async () => {
  try {
    if (!navigator.clipboard) throw new Error("clipboard api unavailable");
    await navigator.clipboard.writeText(jsonText.value);
  } catch {
    copyViaTextarea(jsonText.value);
  }
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 900);
};

onBeforeUnmount(endInteraction);
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
.callout-actions {
  position: sticky;
  top: 0;
  z-index: 1;
  float: right;
  display: flex;
  gap: 2px;
  margin-left: 8px;
  background: var(--t-surface);
}
.callout-actions svg {
  width: 14px;
  height: 14px;
}
</style>
