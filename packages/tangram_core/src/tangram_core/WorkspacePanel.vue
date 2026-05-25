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
        <button
          v-if="collapsibleDatasetCount > 0"
          class="text-btn"
          @click="toggleAllCollapsed"
        >
          {{ allCollapsed ? "expand all" : "collapse all" }}
        </button>
        <button class="text-btn" @click="api.workspace.setAllVisibility(allHidden)">
          {{ allHidden ? "show all" : "hide all" }}
        </button>
        <span class="pending-keys" :class="{ 'is-visible': !!pendingKeys }">
          {{ pendingKeys ?? "" }}
        </span>
      </div>
      <button class="text-btn danger" @click="api.workspace.clear()">clear all</button>
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
          <button
            v-if="row.components?.details"
            class="icon-btn"
            :title="
              isCollapsed(row.dataset.id) ? 'expand settings' : 'collapse settings'
            "
            @click="toggleCollapsed(row.dataset.id)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-if="isCollapsed(row.dataset.id)" d="m9 18 6-6-6-6" />
              <path v-else d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <span v-else class="chevron-spacer" aria-hidden="true"></span>
          <button
            class="visibility-btn"
            :title="row.dataset.visible ? 'hide layer' : 'show layer'"
            @click="api.workspace.toggleVisibility(row.dataset.id)"
          >
            <svg
              v-if="row.dataset.visible"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m15 18-.722-3.25" />
              <path d="M2 8a10.645 10.645 0 0 0 20 0" />
              <path d="m20 15-1.726-2.05" />
              <path d="m4 15 1.726-2.05" />
              <path d="m9 18 .722-3.25" />
            </svg>
          </button>
          <span
            class="dataset-label"
            title="fit layer bounds"
            @click="flyToDataset(row.dataset)"
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
          <button
            class="icon-btn danger"
            title="remove layer"
            @click="api.workspace.remove(row.dataset.id)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
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
import { useVimList } from "./keyboard";

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
      flyToDataset(subset[0]);
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

onUnmounted(() => {
  if (activeDatasetFrame !== null) {
    window.cancelAnimationFrame(activeDatasetFrame);
  }
});

function flyToDataset(dataset: WorkspaceDatasetEntry) {
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

.visibility-btn,
.icon-btn,
.text-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--t-muted);
  display: flex;
  align-items: center;
}

.visibility-btn:hover,
.icon-btn:hover,
.text-btn:hover {
  color: var(--t-accent1);
}

.icon-btn {
  width: 16px;
  height: 16px;
  justify-content: center;
  font-size: 12px;
}

.chevron-spacer {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.text-btn {
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

.dataset-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
  margin: 0 0 6px 0;
  border-radius: 8px;
}
</style>
