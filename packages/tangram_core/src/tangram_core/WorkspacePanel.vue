<template>
  <div
    ref="panelRef"
    class="workspace-panel"
    tabindex="0"
    @mouseenter="onListEnter"
    @mouseleave="onListLeave"
  >
    <div v-if="datasetRows.length > 0" class="list-actions">
      <div class="list-actions-primary">
        <IconButton
          v-if="collapsibleDatasetCount > 0"
          class="icon-btn"
          size="xs"
          variant="plain"
          muted
          :title="allCollapsed ? 'expand all' : 'collapse all'"
          @click="toggleAllCollapsed"
        >
          <svg
            class="collapse-toggle-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 -960 960 960"
            fill="currentColor"
            aria-hidden="true"
          >
            <path :d="allCollapsed ? ICON_PATHS.expandAll : ICON_PATHS.collapseAll" />
          </svg>
        </IconButton>
        <IconButton
          class="text-btn"
          :icon-only="false"
          size="xs"
          variant="plain"
          muted
          @click="api.workspace.setAllVisibility(allHidden)"
        >
          {{ allHidden ? "show all" : "hide all" }}
        </IconButton>
        <span class="pending-keys" :class="{ 'is-visible': !!pendingKeys }">
          {{ pendingKeys ?? "" }}
        </span>
      </div>
      <IconButton
        class="text-btn danger"
        :icon-only="false"
        size="xs"
        variant="plain"
        muted
        danger
        @click="api.workspace.clear()"
      >
        clear all
      </IconButton>
    </div>
    <div v-if="datasetRows.length === 0" class="empty-state">
      drop supported files anywhere on the map to add a layer
    </div>
    <div
      v-for="(row, index) in datasetRows"
      :key="row.dataset.id"
      class="dataset-item"
      :data-dataset-index="index"
      :class="{ 'is-focused': index === focusedIndex }"
      @mouseenter="onDatasetEnter(index)"
    >
      <div class="dataset-header">
        <div class="left-col">
          <IconButton
            v-if="row.components?.details"
            class="icon-btn"
            size="xs"
            variant="plain"
            muted
            :title="
              isCollapsed(row.dataset.id) ? 'expand settings' : 'collapse settings'
            "
            @click="toggleCollapsed(row.dataset.id)"
          >
            <SvgIcon
              class="dataset-chevron"
              :class="{ 'is-open': !isCollapsed(row.dataset.id) }"
              :path="ICON_PATHS.chevronRight"
            />
          </IconButton>
          <span v-else class="chevron-spacer" aria-hidden="true"></span>
          <IconButton
            class="visibility-btn"
            size="xs"
            variant="plain"
            muted
            :title="row.dataset.visible ? 'hide layer' : 'show layer'"
            @click="api.workspace.toggleVisibility(row.dataset.id)"
          >
            <SvgIcon
              :path="
                row.dataset.visible ? ICON_PATHS.visibility : ICON_PATHS.visibilityOff
              "
            />
          </IconButton>
          <span
            class="dataset-label"
            :class="{ 'is-selected': row.dataset.id === selectedDatasetId }"
            :title="
              row.dataset.timeRange
                ? 'fit layer bounds and open playback'
                : 'fit layer bounds'
            "
            @click="focusDataset(row.dataset)"
          >
            {{ row.dataset.label }}
          </span>
        </div>
        <div class="right-col">
          <component
            :is="row.components?.chip"
            v-if="row.components?.chip"
            :dataset="row.dataset"
          />
          <IconButton
            class="icon-btn danger"
            size="xs"
            variant="plain"
            muted
            danger
            title="remove layer"
            @click="api.workspace.remove(row.dataset.id)"
          >
            <SvgIcon :path="ICON_PATHS.delete" />
          </IconButton>
        </div>
      </div>
      <div
        v-if="!isCollapsed(row.dataset.id) && row.components?.details"
        class="dataset-details"
      >
        <component :is="row.components?.details" :dataset="row.dataset" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, ref, reactive, computed, watch, nextTick, onUnmounted } from "vue";
import type { TangramApi, WorkspaceDatasetEntry } from "./api";
import IconButton from "./IconButton.vue";
import SvgIcon from "./SvgIcon.vue";
import { useVimList } from "./keyboard";
import { ICON_PATHS } from "./utils";

const api = inject<TangramApi>("tangramApi")!;
const datasets = api.workspace.datasets;
const workspaceComponents = api.ui.workspaceComponents;
const datasetRows = computed(() =>
  datasets.value.map(dataset => ({
    dataset,
    components: workspaceComponents.value.get(dataset.kind)
  }))
);
const collapsedDatasets = reactive(new Set<string>());
const isActive = ref(false);
const panelRef = ref<HTMLElement | null>(null);
const selectedDatasetId = ref<string | null>(null);
let activeDatasetFrame: number | null = null;

const { focusedIndex, pendingKeys, setFocus } = useVimList(datasets, {
  isActive,
  target: panelRef,
  onAction: (action, start, count) => {
    const subset = datasets.value.slice(start, start + count);
    if (action === "delete") {
      subset.map(d => d.id).forEach(id => api.workspace.remove(id));
    } else if (action === "toggle") {
      subset.map(d => d.id).forEach(id => api.workspace.toggleVisibility(id));
    } else if (action === "select" && subset.length > 0) {
      focusDataset(subset[0]);
    }
  }
});

const allHidden = computed(() => datasets.value.every(d => !d.visible));
const collapsibleDatasetIds = computed(() =>
  datasetRows.value.filter(row => row.components?.details).map(row => row.dataset.id)
);
const collapsibleDatasetCount = computed(() => collapsibleDatasetIds.value.length);
const allCollapsed = computed(
  () =>
    collapsibleDatasetIds.value.length > 0 &&
    collapsibleDatasetIds.value.every(id => collapsedDatasets.has(id))
);

function toggleAllCollapsed() {
  if (allCollapsed.value) {
    collapsedDatasets.clear();
    return;
  }
  collapsedDatasets.clear();
  for (const id of collapsibleDatasetIds.value) {
    collapsedDatasets.add(id);
  }
}

function scheduleActiveDataset(id: string | null) {
  if (activeDatasetFrame !== null) {
    window.cancelAnimationFrame(activeDatasetFrame);
  }
  activeDatasetFrame = window.requestAnimationFrame(() => {
    api.workspace.setActiveDataset(id);
    activeDatasetFrame = null;
  });
}

function onDatasetEnter(index: number) {
  setFocus(index);
}

function onListEnter() {
  isActive.value = true;
  panelRef.value?.focus({ preventScroll: true });
}

function onListLeave() {
  isActive.value = false;
  setFocus(null);
}

watch(
  focusedIndex,
  async idx => {
    scheduleActiveDataset(
      idx !== null && idx >= 0 && idx < datasets.value.length
        ? datasets.value[idx].id
        : null
    );

    if (idx === null || idx < 0) return;

    await nextTick();
    const container = panelRef.value;
    if (!container) return;

    const item = container.querySelector<HTMLElement>(`[data-dataset-index="${idx}"]`);
    item?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" }
);

watch(datasets, entries => {
  if (
    selectedDatasetId.value &&
    !entries.some(entry => entry.id === selectedDatasetId.value)
  ) {
    selectedDatasetId.value = null;
  }
});

onUnmounted(() => {
  if (activeDatasetFrame !== null) {
    window.cancelAnimationFrame(activeDatasetFrame);
  }
});

function focusDataset(dataset: WorkspaceDatasetEntry) {
  selectedDatasetId.value = dataset.id;

  if (dataset.timeRange) {
    api.time.fitToRange(dataset.timeRange, {
      anchor: "end",
      enterHistory: true
    });
  }

  const bounds = dataset.bounds;
  if (!bounds) return;
  api.map.getMapInstance().fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat]
    ],
    { padding: 48, maxZoom: 14 }
  );
}

function isCollapsed(id: string): boolean {
  return collapsedDatasets.has(id);
}

function toggleCollapsed(id: string) {
  if (collapsedDatasets.has(id)) {
    collapsedDatasets.delete(id);
  } else {
    collapsedDatasets.add(id);
  }
}
</script>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  max-height: 520px;
  overflow-y: auto;
  color: var(--t-fg);
}

.list-actions {
  display: flex;
  justify-content: space-between;
  padding: 2px 4px;
  border-bottom: 1px solid var(--t-border);
}

.list-actions-primary {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pending-keys {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4ch;
  padding: 0 4px;
  border: 1px solid var(--t-border);
  border-radius: 4px;
  color: var(--t-muted);
  font-size: 0.72em;
  font-family: "Inconsolata", monospace;
  line-height: 1.2;
  visibility: hidden;
}

.pending-keys.is-visible {
  visibility: visible;
}

.empty-state {
  padding: 1rem;
  text-align: center;
  color: var(--t-muted);
  font-size: 0.9em;
  font-style: italic;
}

.dataset-item {
  padding: 0 6px;
  border-bottom: 1px solid var(--t-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
}

.dataset-item.is-focused {
  background-color: var(--t-hover);
}

.dataset-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.left-col {
  display: flex;
  align-items: center;
  gap: 8px;
}

.right-col {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  justify-self: end;
}

.visibility-btn:hover,
.icon-btn:hover,
.text-btn:hover {
  color: var(--t-accent1);
}

.icon-btn {
  width: 18px;
  min-width: 18px;
  min-height: 18px;
  font-size: 12px;
}

.dataset-chevron {
  transition: transform 0.15s ease;
}

.collapse-toggle-icon {
  width: 14px;
  height: 14px;
  display: block;
}

.dataset-chevron.is-open {
  transform: rotate(90deg);
}

.chevron-spacer {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.text-btn {
  color: var(--t-muted);
  font-size: 0.75em;
  font-family: "B612", sans-serif;
}

.icon-btn.danger:hover,
.text-btn.danger:hover {
  color: var(--t-error);
}

.dataset-label {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  color: var(--t-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: "B612", sans-serif;
  cursor: pointer;
}

.dataset-label:hover {
  text-decoration: underline;
}

.dataset-label.is-selected {
  font-weight: 700;
}

.dataset-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
  margin: 0 0 6px 0;
  border-radius: 8px;
}
</style>
