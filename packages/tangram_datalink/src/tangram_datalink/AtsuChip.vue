<template>
  <span
    v-if="code"
    ref="rootRef"
    class="atsu-chip"
    tabindex="0"
    @mouseenter="openPopover"
    @mousemove="movePopover"
    @mouseleave="closePopover"
    @focus="openPopover"
    @blur="closePopover"
  >
    <span class="atsu-chip-label">{{ label }}</span>
  </span>
  <Teleport to="body">
    <span
      v-if="isOpen && code"
      class="atsu-popover"
      :style="popoverStyle"
      role="tooltip"
    >
      <span class="atsu-popover-key">prefix</span>
      <span>{{ record?.prefix ?? "—" }}</span>
      <span class="atsu-popover-key">network</span>
      <span>{{ record?.network ?? "—" }}</span>
      <span class="atsu-popover-key">code</span>
      <span>{{ code }}</span>
    </span>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, type CSSProperties } from "vue";
import { atsuMetadata, loadAtsuMetadata, normalizeAtsuCode } from "./atsu";

const props = defineProps<{
  address?: string | null;
}>();

const rootRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const popoverX = ref(0);
const popoverY = ref(0);
const code = computed(() => normalizeAtsuCode(props.address));
const record = computed(() => atsuMetadata.value[code.value]);
const label = computed(() => record.value?.name ?? code.value);

const POPOVER_OFFSET_PX = 10;
const POPOVER_MAX_WIDTH_PX = 224;
const POPOVER_MAX_HEIGHT_PX = 90;
const VIEWPORT_MARGIN_PX = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const popoverStyle = computed<CSSProperties>(() => ({
  left: `${popoverX.value}px`,
  top: `${popoverY.value}px`
}));

const setPopoverPosition = (x: number, y: number) => {
  popoverX.value = clamp(
    x,
    VIEWPORT_MARGIN_PX,
    window.innerWidth - POPOVER_MAX_WIDTH_PX - VIEWPORT_MARGIN_PX
  );
  popoverY.value = clamp(
    y,
    VIEWPORT_MARGIN_PX,
    window.innerHeight - POPOVER_MAX_HEIGHT_PX - VIEWPORT_MARGIN_PX
  );
};

const movePopover = (event: MouseEvent) => {
  setPopoverPosition(
    event.clientX + POPOVER_OFFSET_PX,
    event.clientY + POPOVER_OFFSET_PX
  );
};

const openPopover = (event: MouseEvent | FocusEvent) => {
  isOpen.value = true;
  if (event instanceof MouseEvent) {
    movePopover(event);
    return;
  }

  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) return;
  setPopoverPosition(rect.left, rect.bottom + 4);
};

const closePopover = () => {
  isOpen.value = false;
};

onMounted(() => {
  void loadAtsuMetadata();
});
</script>

<style scoped>
.atsu-chip {
  display: inline-flex;
  max-width: min(20rem, 100%);
  height: 17px;
  align-items: center;
  --cat-color: color-mix(in oklch, var(--t-muted) 80%, var(--t-fg));
  --cat-bg: color-mix(in oklch, var(--cat-color) 14%, var(--t-bg));
  --cat-border: color-mix(in oklch, var(--cat-color) 38%, var(--t-border));
  --cat-fg: color-mix(in oklch, var(--cat-color) 76%, var(--t-fg));
  border: 1px solid var(--cat-border);
  border-radius: 4px;
  background: var(--cat-bg);
  color: var(--cat-fg);
  cursor: help;
  font-family: "Inconsolata", monospace;
  font-size: 0.8em;
  font-weight: 700;
  line-height: 1;
  padding: 1px 4px 0;
  box-sizing: border-box;
  vertical-align: middle;
  white-space: nowrap;
}

.atsu-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atsu-popover {
  position: fixed;
  z-index: 5000;
  display: grid;
  width: max-content;
  max-width: 14rem;
  grid-template-columns: max-content max-content;
  gap: 1px 8px;
  border: 1px solid var(--t-border);
  border-radius: 10px;
  background: var(--t-bg);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
  color: var(--t-fg);
  font-family: "B612", sans-serif;
  font-size: 0.8em;
  font-weight: 400;
  line-height: 1.15;
  padding: 4px 7px;
  pointer-events: none;
}

.atsu-popover-key {
  color: var(--t-muted);
  font-family: "Inconsolata", monospace;
}
</style>
