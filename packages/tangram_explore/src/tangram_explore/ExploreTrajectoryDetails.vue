<template>
  <div class="trajectory-controls">
    <label class="control-row">
      <span>style</span>
      <select
        :value="layer.style.style_mode"
        @change="setStyleMode(eventValue($event) as 'single' | 'category')"
      >
        <option value="single">single color</option>
        <option value="category">by category</option>
      </select>
    </label>

    <label v-if="layer.style.style_mode === 'category'" class="control-row">
      <span>field</span>
      <select
        :value="layer.style.category_field"
        @change="setCategoryField(eventValue($event))"
      >
        <option value="">choose field</option>
        <option v-for="field in propertyFields" :key="field" :value="field">
          {{ field }}
        </option>
      </select>
    </label>

    <label v-if="layer.style.style_mode === 'single'" class="control-row">
      <span>line</span>
      <ColorPicker
        :model-value="colorSpecToHex(layer.style.line_color) ?? FALLBACK_ACCENT_HEX"
        @update:model-value="value => updateStyle({ line_color: value })"
      />
    </label>

    <div
      v-if="layer.style.style_mode === 'category' && layer.style.category_field"
      class="category-list"
    >
      <div v-for="category in categoryStats" :key="category.value" class="category-row">
        <label class="category-visible">
          <input
            type="checkbox"
            :checked="!layer.style.hidden_categories[category.value]"
            @change="toggleCategory(category.value)"
          />
          <span class="category-name">{{ category.value }}</span>
          <span class="category-count">{{ category.count }}</span>
        </label>
        <input
          type="color"
          :value="categoryColor(category.value)"
          @input="setCategoryColor(category.value, eventValue($event))"
        />
      </div>
    </div>

    <label class="control-row slider-row">
      <span>opacity</span>
      <span class="control-value">{{ formatSliderValue(layer.style.opacity, 2) }}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.02"
        :value="layer.style.opacity"
        @input="updateStyle({ opacity: eventNumber($event) })"
      />
    </label>
    <label class="control-row slider-row">
      <span>line width</span>
      <span class="control-value">{{ formatSliderValue(layer.style.line_width) }}</span>
      <input
        type="range"
        min="1"
        max="12"
        step="0.5"
        :value="layer.style.line_width"
        @input="updateStyle({ line_width: eventNumber($event) })"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { ColorPicker } from "@open-aviation/tangram-core/components";
import { colorSpecToHex } from "@open-aviation/tangram-core/utils";
import type {
  TangramApi,
  WorkspaceDatasetEntry
} from "@open-aviation/tangram-core/api";
import type { TrajectoryDatasetEntry, TrajectoryStyleOptions } from "./datasets";
import { trajectoryColorsForField, trajectoryStatsForField } from "./trajectory_source";

const FALLBACK_ACCENT_HEX = "#027ec7";

const props = defineProps<{ dataset: WorkspaceDatasetEntry }>();
const api = inject<TangramApi>("tangramApi")!;

const layer = computed(() => props.dataset as TrajectoryDatasetEntry);
const propertyFields = computed(() => layer.value.payload.fields);
const categoryStats = computed(() =>
  trajectoryStatsForField(layer.value.payload, layer.value.style.category_field)
);

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function eventNumber(event: Event): number {
  return Number(eventValue(event));
}

function formatSliderValue(value: number, fractionDigits = 1): string {
  return value
    .toFixed(fractionDigits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

function updateStyle(patch: Partial<TrajectoryStyleOptions>) {
  api.workspace.update(layer.value.id, entry => {
    const trajectoryEntry = entry as TrajectoryDatasetEntry;
    trajectoryEntry.style = { ...trajectoryEntry.style, ...patch };
  });
}

function setStyleMode(mode: "single" | "category") {
  if (mode === "single") {
    updateStyle({ style_mode: mode });
    return;
  }

  const field =
    layer.value.style.category_field ||
    layer.value.payload.styleHints.categoryField ||
    propertyFields.value[0] ||
    "";

  updateStyle({
    style_mode: mode,
    category_field: field,
    category_colors: trajectoryColorsForField(
      layer.value.payload,
      field,
      layer.value.style.category_colors
    )
  });
}

function setCategoryField(field: string) {
  updateStyle({
    category_field: field,
    hidden_categories: {},
    category_colors: trajectoryColorsForField(
      layer.value.payload,
      field,
      layer.value.style.category_colors
    )
  });
}

function categoryColor(category: string): string {
  return colorSpecToHex(layer.value.style.category_colors[category]) ?? "#808080";
}

function setCategoryColor(category: string, color: string) {
  api.workspace.update(layer.value.id, entry => {
    const trajectoryEntry = entry as TrajectoryDatasetEntry;
    trajectoryEntry.style = {
      ...trajectoryEntry.style,
      category_colors: {
        ...trajectoryEntry.style.category_colors,
        [category]: color
      }
    };
  });
}

function toggleCategory(category: string) {
  api.workspace.update(layer.value.id, entry => {
    const trajectoryEntry = entry as TrajectoryDatasetEntry;
    trajectoryEntry.style = {
      ...trajectoryEntry.style,
      hidden_categories: {
        ...trajectoryEntry.style.hidden_categories,
        [category]: !trajectoryEntry.style.hidden_categories[category]
      }
    };
  });
}
</script>

<style scoped>
.trajectory-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
</style>
