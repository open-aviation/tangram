<template>
  <span v-if="point" class="chip">{{ point.kind.toUpperCase() }}</span>
  <IconButton
    v-else
    size="xs"
    variant="plain"
    muted
    :title="copyTitle"
    :aria-label="copyTitle"
    @click.stop="copyRoute"
  >
    <SvgIcon :path="copyIcon" />
  </IconButton>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { IconButton, SvgIcon } from "@open-aviation/tangram-core/components";
import { ICON_PATHS } from "@open-aviation/tangram-core/utils";
import {
  isNavaidPointEntry,
  isPlannedRouteEntry,
  type NavaidDatasetEntry
} from "./datasets";

const props = defineProps<{ dataset: NavaidDatasetEntry }>();
const point = computed(() =>
  isNavaidPointEntry(props.dataset) ? props.dataset.payload.point : null
);
type CopyStatus = "idle" | "copied" | "failed";

const copyStatus = ref<CopyStatus>("idle");
const copyTitle = computed(() => {
  if (copyStatus.value === "copied") return "copied";
  if (copyStatus.value === "failed") return "copy failed";
  return "copy route";
});
const copyIcon = computed(() => {
  if (copyStatus.value === "copied") return ICON_PATHS.check;
  if (copyStatus.value === "failed") return ICON_PATHS.warning;
  return ICON_PATHS.contentCopy;
});
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function showCopyStatus(status: Exclude<CopyStatus, "idle">): void {
  copyStatus.value = status;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    copyStatus.value = "idle";
    feedbackTimer = null;
  }, 1200);
}

async function copyRoute(): Promise<void> {
  if (!isPlannedRouteEntry(props.dataset)) return;
  try {
    await navigator.clipboard.writeText(props.dataset.payload.expression);
    showCopyStatus("copied");
  } catch {
    showCopyStatus("failed");
  }
}

onUnmounted(() => {
  if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>

<style scoped>
.chip {
  border-radius: 4px;
  background: var(--t-accent2);
  color: var(--t-accent2-fg);
  padding: 1px 4px;
  font-size: 10px;
}
</style>
