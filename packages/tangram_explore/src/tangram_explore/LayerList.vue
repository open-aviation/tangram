<template>
  <div
    ref="layerListRef"
    class="layer-list"
    tabindex="0"
    @mouseenter="onListEnter"
    @mouseleave="onListLeave"
  >
    <div v-if="layers.length > 0" class="list-actions">
      <div class="list-actions-primary">
        <button
          v-if="collapsibleLayerCount > 0"
          class="text-btn"
          @click="toggleAllCollapsed"
        >
          {{ allCollapsed ? "expand all" : "collapse all" }}
        </button>
        <button class="text-btn" @click="toggleAllVisibility">
          {{ allHidden ? "show all" : "hide all" }}
        </button>
        <span class="pending-keys" :class="{ 'is-visible': !!pendingKeys }">
          {{ pendingKeys ?? "" }}
        </span>
      </div>
      <button class="text-btn danger" @click="clearLayers">clear all</button>
    </div>
    <div v-if="layers.length === 0" class="empty-state">
      drop supported files anywhere on the map to add an explore layer
    </div>
    <div
      v-for="(layer, index) in layers"
      :key="layer.id"
      class="layer-item"
      :data-layer-index="index"
      :class="{ 'is-focused': index === focusedIndex }"
      @mouseenter="onLayerEnter(index)"
    >
      <div class="layer-header">
        <div class="left-col">
          <button
            v-if="layer.source.kind !== 'table'"
            class="icon-btn"
            :title="isCollapsed(layer.id) ? 'expand settings' : 'collapse settings'"
            @click="toggleCollapsed(layer.id)"
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
              <path v-if="isCollapsed(layer.id)" d="m9 18 6-6-6-6" />
              <path v-else d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            class="visibility-btn"
            :title="layer.visible ? 'hide layer' : 'show layer'"
            @click="toggleLayerVisibility(layer.id)"
          >
            <svg
              v-if="layer.visible"
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
          <span class="layer-label" title="fit layer bounds" @click="flyToLayer(layer)">
            {{ layer.label }}
          </span>
        </div>
        <div class="right-col">
          <div class="layer-chip">
            <div
              class="status-dot"
              :style="{ backgroundColor: getLayerColor(layer.style) }"
            ></div>
            <span class="layer-stats">{{ getLayerStats(layer) }}</span>
          </div>
          <button
            class="icon-btn danger"
            title="remove layer"
            @click="removeLayer(layer.id)"
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
        v-if="isFeatureLayer(layer) && !isCollapsed(layer.id)"
        class="feature-controls"
      >
        <label class="control-row">
          <span>style</span>
          <select
            :value="layer.style.style_mode"
            @change="setStyleMode(layer, eventValue($event) as 'single' | 'category')"
          >
            <option value="single">single color</option>
            <option value="category">by category</option>
          </select>
        </label>

        <label v-if="layer.style.style_mode === 'category'" class="control-row">
          <span>field</span>
          <select
            :value="layer.style.category_field"
            @change="setCategoryField(layer, eventValue($event))"
          >
            <option value="">choose field</option>
            <option v-for="field in propertyFields(layer)" :key="field" :value="field">
              {{ field }}
            </option>
          </select>
        </label>

        <template v-if="layer.style.style_mode === 'single'">
          <label class="control-row">
            <span>fill</span>
            <ColorPicker
              :model-value="
                colorSpecToHex(layer.style.fill_color) ?? FALLBACK_ACCENT_HEX
              "
              @update:model-value="
                value => updateFeatureStyle(layer, { fill_color: value })
              "
            />
          </label>
          <label class="control-row">
            <span>line</span>
            <ColorPicker
              :model-value="
                colorSpecToHex(layer.style.line_color) ?? FALLBACK_ACCENT_HEX
              "
              @update:model-value="
                value => updateFeatureStyle(layer, { line_color: value })
              "
            />
          </label>
        </template>

        <div
          v-if="layer.style.style_mode === 'category' && layer.style.category_field"
          class="category-list"
        >
          <div
            v-for="category in categoryStats(layer)"
            :key="category.value"
            class="category-row"
          >
            <label class="category-visible">
              <input
                type="checkbox"
                :checked="!layer.style.hidden_categories[category.value]"
                @change="toggleFeatureCategory(layer, category.value)"
              />
              <span class="category-name">{{ category.value }}</span>
              <span class="category-count">{{ category.count }}</span>
            </label>
            <input
              type="color"
              :value="categoryColor(layer, category.value)"
              @input="
                setFeatureCategoryColor(layer, category.value, eventValue($event))
              "
            />
          </div>
        </div>

        <label class="control-row slider-row">
          <span>opacity</span>
          <span class="control-value">{{
            formatSliderValue(layer.style.opacity, 2)
          }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            :value="layer.style.opacity"
            @input="updateFeatureStyle(layer, { opacity: eventNumber($event) })"
          />
        </label>
        <label class="control-row slider-row">
          <span>line width</span>
          <span class="control-value">{{
            formatSliderValue(layer.style.line_width)
          }}</span>
          <input
            type="range"
            min="0"
            max="12"
            step="0.5"
            :value="layer.style.line_width"
            @input="updateFeatureStyle(layer, { line_width: eventNumber($event) })"
          />
        </label>
        <label class="control-row slider-row">
          <span>point radius</span>
          <span class="control-value">{{
            formatSliderInteger(layer.style.point_radius)
          }}</span>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            :value="layer.style.point_radius"
            @input="updateFeatureStyle(layer, { point_radius: eventNumber($event) })"
          />
        </label>
        <div class="checkbox-row">
          <label>
            <input
              type="checkbox"
              :checked="layer.style.filled"
              @change="updateFeatureStyle(layer, { filled: eventChecked($event) })"
            />
            filled
          </label>
          <label>
            <input
              type="checkbox"
              :checked="layer.style.stroked"
              @change="updateFeatureStyle(layer, { stroked: eventChecked($event) })"
            />
            stroked
          </label>
        </div>
      </div>

      <div
        v-if="isTrajectoryLayer(layer) && !isCollapsed(layer.id)"
        class="feature-controls"
      >
        <label class="control-row">
          <span>style</span>
          <select
            :value="layer.style.style_mode"
            @change="
              setTrajectoryStyleMode(layer, eventValue($event) as 'single' | 'category')
            "
          >
            <option value="single">single color</option>
            <option value="category">by category</option>
          </select>
        </label>

        <label v-if="layer.style.style_mode === 'category'" class="control-row">
          <span>field</span>
          <select
            :value="layer.style.category_field"
            @change="setTrajectoryCategoryField(layer, eventValue($event))"
          >
            <option value="">choose field</option>
            <option
              v-for="field in trajectoryFields(layer)"
              :key="field"
              :value="field"
            >
              {{ field }}
            </option>
          </select>
        </label>

        <label v-if="layer.style.style_mode === 'single'" class="control-row">
          <span>line</span>
          <ColorPicker
            :model-value="colorSpecToHex(layer.style.line_color) ?? FALLBACK_ACCENT_HEX"
            @update:model-value="
              value => updateTrajectoryStyle(layer, { line_color: value })
            "
          />
        </label>

        <div
          v-if="layer.style.style_mode === 'category' && layer.style.category_field"
          class="category-list"
        >
          <div
            v-for="category in trajectoryCategoryStats(layer)"
            :key="category.value"
            class="category-row"
          >
            <label class="category-visible">
              <input
                type="checkbox"
                :checked="!layer.style.hidden_categories[category.value]"
                @change="toggleTrajectoryCategory(layer, category.value)"
              />
              <span class="category-name">{{ category.value }}</span>
              <span class="category-count">{{ category.count }}</span>
            </label>
            <input
              type="color"
              :value="trajectoryCategoryColor(layer, category.value)"
              @input="
                setTrajectoryCategoryColor(layer, category.value, eventValue($event))
              "
            />
          </div>
        </div>

        <label class="control-row slider-row">
          <span>opacity</span>
          <span class="control-value">{{
            formatSliderValue(layer.style.opacity, 2)
          }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            :value="layer.style.opacity"
            @input="updateTrajectoryStyle(layer, { opacity: eventNumber($event) })"
          />
        </label>
        <label class="control-row slider-row">
          <span>line width</span>
          <span class="control-value">{{
            formatSliderValue(layer.style.line_width)
          }}</span>
          <input
            type="range"
            min="1"
            max="12"
            step="0.5"
            :value="layer.style.line_width"
            @input="updateTrajectoryStyle(layer, { line_width: eventNumber($event) })"
          />
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ColorPicker } from "@open-aviation/tangram-core/components";
import { useVimList } from "@open-aviation/tangram-core/keyboard";
import { colorSpecToHex, parseColorSpec } from "@open-aviation/tangram-core/utils";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import {
  layers,
  activeLayerId,
  clearLayers,
  removeLayer,
  toggleLayerVisibility,
  updateFeatureStyle,
  setFeatureCategoryColor,
  toggleFeatureCategory,
  updateTrajectoryStyle,
  setTrajectoryCategoryColor,
  toggleTrajectoryCategory,
  type FeatureLayerEntry,
  type LayerEntry,
  type StyleOptions,
  type TrajectoryLayerEntry
} from "./store";
import {
  reactive,
  computed,
  inject,
  nextTick,
  onUnmounted,
  ref,
  triggerRef,
  watch
} from "vue";
import { categoryColorsForField, categoryStatsForField } from "./feature_source";
import { trajectoryColorsForField, trajectoryStatsForField } from "./trajectory_source";

const api = inject<TangramApi>("tangramApi")!;
const collapsedLayers = reactive(new Set<string>());
const FALLBACK_ACCENT_HEX = "#027ec7";
const isActive = ref(false);
const layerListRef = ref<HTMLElement | null>(null);
let activeLayerFrame: number | null = null;

const { focusedIndex, pendingKeys, setFocus } = useVimList(layers, {
  isActive,
  target: layerListRef,
  onAction: (action, start, count) => {
    const subset = layers.value.slice(start, start + count);
    if (action === "delete") {
      subset.map(l => l.id).forEach(removeLayer);
    } else if (action === "toggle") {
      subset.map(l => l.id).forEach(toggleLayerVisibility);
    } else if (action === "select" && subset.length > 0) {
      flyToLayer(subset[0]);
    }
  }
});

const allHidden = computed(() => layers.value.every(l => !l.visible));
const collapsibleLayerIds = computed(() =>
  layers.value.filter(layer => layer.source.kind !== "table").map(layer => layer.id)
);
const collapsibleLayerCount = computed(() => collapsibleLayerIds.value.length);
const allCollapsed = computed(
  () =>
    collapsibleLayerIds.value.length > 0 &&
    collapsibleLayerIds.value.every(id => collapsedLayers.has(id))
);

function toggleAllVisibility() {
  const targetState = allHidden.value;
  layers.value.forEach(l => {
    l.visible = targetState;
  });
  triggerRef(layers);
}

function toggleAllCollapsed() {
  if (allCollapsed.value) {
    collapsedLayers.clear();
    return;
  }

  collapsedLayers.clear();
  for (const id of collapsibleLayerIds.value) {
    collapsedLayers.add(id);
  }
}

function scheduleActiveLayer(id: string | null) {
  if (activeLayerFrame !== null) {
    window.cancelAnimationFrame(activeLayerFrame);
  }

  activeLayerFrame = window.requestAnimationFrame(() => {
    activeLayerId.value = id;
    activeLayerFrame = null;
  });
}

function onLayerEnter(index: number) {
  setFocus(index);
}

function onListEnter() {
  isActive.value = true;
  layerListRef.value?.focus({ preventScroll: true });
}

function onListLeave() {
  isActive.value = false;
  setFocus(null);
}

watch(
  focusedIndex,
  async idx => {
    scheduleActiveLayer(
      idx !== null && idx >= 0 && idx < layers.value.length
        ? layers.value[idx].id
        : null
    );

    if (idx === null || idx < 0) return;

    await nextTick();
    const container = layerListRef.value;
    if (!container) return;

    const item = container.querySelector<HTMLElement>(`[data-layer-index="${idx}"]`);
    item?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" }
);

onUnmounted(() => {
  if (activeLayerFrame !== null) {
    window.cancelAnimationFrame(activeLayerFrame);
  }
});

function flyToLayer(layer: LayerEntry) {
  const bounds = layer.source.bounds;
  if (!bounds) return;
  api.map.getMapInstance().fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat]
    ],
    { padding: 48, maxZoom: 14 }
  );
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function eventNumber(event: Event): number {
  return Number(eventValue(event));
}

function eventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function formatSliderValue(value: number, fractionDigits = 1): string {
  return value
    .toFixed(fractionDigits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

function formatSliderInteger(value: number): string {
  return `${Math.round(value)}`;
}

function isCollapsed(id: string): boolean {
  return collapsedLayers.has(id);
}

function toggleCollapsed(id: string) {
  if (collapsedLayers.has(id)) {
    collapsedLayers.delete(id);
  } else {
    collapsedLayers.add(id);
  }
}

function getLayerColor(style: StyleOptions): string {
  const color = style.kind === "trajectory" ? style.line_color : style.fill_color;
  const [r, g, b, a] = parseColorSpec(color) ?? [128, 128, 128, 255];
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function getLayerStats(layer: LayerEntry): string {
  if (layer.source.kind === "table") {
    return `${layer.source.stats.rowCount.toLocaleString()} rows`;
  }

  if (layer.source.kind === "trajectories") {
    return `${layer.source.stats.trajectoryCount.toLocaleString()} trajectories`;
  }

  return `${layer.source.stats.featureCount.toLocaleString()} features`;
}

function isFeatureLayer(layer: LayerEntry): layer is FeatureLayerEntry {
  return layer.source.kind === "features";
}

function isTrajectoryLayer(layer: LayerEntry): layer is TrajectoryLayerEntry {
  return layer.source.kind === "trajectories";
}

function propertyFields(layer: FeatureLayerEntry): string[] {
  return layer.source.fields;
}

function categoryStats(layer: FeatureLayerEntry) {
  return categoryStatsForField(layer.source, layer.style.category_field);
}

function categoryColor(layer: FeatureLayerEntry, category: string): string {
  return colorSpecToHex(layer.style.category_colors[category]) ?? "#808080";
}

function setStyleMode(layer: FeatureLayerEntry, mode: "single" | "category") {
  if (mode === "single") {
    updateFeatureStyle(layer, { style_mode: mode });
    return;
  }

  const field =
    layer.style.category_field ||
    layer.source.styleHints.colorField ||
    propertyFields(layer)[0] ||
    "";
  updateFeatureStyle(layer, {
    style_mode: mode,
    category_field: field,
    category_colors: categoryColorsForField(
      layer.source,
      field,
      layer.style.color_field,
      layer.style.category_colors
    )
  });
}

function setCategoryField(layer: FeatureLayerEntry, field: string) {
  updateFeatureStyle(layer, {
    category_field: field,
    hidden_categories: {},
    category_colors: categoryColorsForField(
      layer.source,
      field,
      layer.style.color_field,
      layer.style.category_colors
    )
  });
}

function trajectoryFields(layer: TrajectoryLayerEntry): string[] {
  return layer.source.fields;
}

function trajectoryCategoryStats(layer: TrajectoryLayerEntry) {
  return trajectoryStatsForField(layer.source, layer.style.category_field);
}

function trajectoryCategoryColor(
  layer: TrajectoryLayerEntry,
  category: string
): string {
  return colorSpecToHex(layer.style.category_colors[category]) ?? "#808080";
}

function setTrajectoryStyleMode(
  layer: TrajectoryLayerEntry,
  mode: "single" | "category"
) {
  if (mode === "single") {
    updateTrajectoryStyle(layer, { style_mode: mode });
    return;
  }

  const field =
    layer.style.category_field ||
    layer.source.styleHints.categoryField ||
    trajectoryFields(layer)[0] ||
    "";
  updateTrajectoryStyle(layer, {
    style_mode: mode,
    category_field: field,
    category_colors: trajectoryColorsForField(
      layer.source,
      field,
      layer.style.category_colors
    )
  });
}

function setTrajectoryCategoryField(layer: TrajectoryLayerEntry, field: string) {
  updateTrajectoryStyle(layer, {
    category_field: field,
    hidden_categories: {},
    category_colors: trajectoryColorsForField(
      layer.source,
      field,
      layer.style.category_colors
    )
  });
}
</script>

<style scoped>
.layer-list {
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

.layer-item {
  padding: 0 6px;
  border-bottom: 1px solid var(--t-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
}

.layer-item.is-focused {
  background-color: var(--t-hover);
}

.layer-header {
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

.text-btn {
  font-size: 0.75em;
  font-family: "B612", sans-serif;
}

.icon-btn.danger:hover,
.text-btn.danger:hover {
  color: var(--t-error);
}

.layer-label {
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

.layer-label:hover {
  text-decoration: underline;
}

.layer-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.layer-stats {
  color: var(--t-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
}

.feature-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
  margin: 0 0 6px 0;
  border-radius: 8px;
}

.control-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
  color: var(--t-fg);
  font-size: 0.82em;
}

.slider-row {
  grid-template-columns: 72px auto 1fr;
}

.control-value {
  min-width: 18px;
  color: var(--t-muted);
  font-size: 0.78em;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.control-row select {
  width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--t-border);
  background: var(--t-bg);
  color: var(--t-fg);
}

.control-row select:hover {
  border-color: var(--t-accent1);
}

.control-row select:focus {
  outline: none;
  border-color: var(--t-accent1);
  box-shadow: 0 0 0 1px var(--t-accent1);
}

.control-row select option {
  background: var(--t-bg);
  color: var(--t-fg);
}

.control-row input[type="range"],
.checkbox-row input[type="checkbox"],
.category-visible input[type="checkbox"] {
  accent-color: var(--t-accent1);
}

.control-row input[type="color"] {
  width: 100%;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--t-border);
  background: var(--t-bg);
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.category-visible {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.category-row input[type="color"] {
  width: 40px;
  min-width: 40px;
  justify-self: end;
}

.category-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--t-fg);
}

.category-count {
  margin-left: auto;
  color: var(--t-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.8em;
}

.checkbox-row {
  display: flex;
  gap: 12px;
  color: var(--t-fg);
  font-size: 0.82em;
}
</style>
