<template>
  <div class="layer-list">
    <div v-if="layers.length > 0" class="list-actions">
      <button class="text-btn danger" @click="clearLayers">clear all</button>
    </div>
    <div v-if="layers.length === 0" class="empty-state">no active layers</div>
    <div v-for="layer in layers" :key="layer.id" class="layer-item">
      <div class="layer-header">
        <div class="left-col">
          <button
            v-if="layer.source === 'geojson'"
            class="icon-btn"
            :title="isCollapsed(layer.id) ? 'expand settings' : 'collapse settings'"
            @click="toggleCollapsed(layer.id)"
          >
            {{ isCollapsed(layer.id) ? '▸' : '▾' }}
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
          <span class="layer-label">{{ layer.label }}</span>
        </div>
        <div class="right-col">
          <span class="layer-stats">{{ getLayerStats(layer) }}</span>
          <div class="layer-chip">
            <div
              class="status-dot"
              :style="{ backgroundColor: getLayerColor(layer.style) }"
            ></div>
            <span class="kind-label">{{ layer.style.kind }}</span>
          </div>
          <button class="text-btn danger" title="remove layer" @click="removeLayer(layer.id)">
            remove
          </button>
        </div>
      </div>

      <div v-if="layer.source === 'geojson' && !isCollapsed(layer.id)" class="geojson-controls">
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
            <input
              type="color"
              :value="colorToHex(layer.style.fill_color)"
              @input="updateGeoJsonStyle(layer.id, { fill_color: eventValue($event) })"
            />
          </label>
          <label class="control-row">
            <span>line</span>
            <input
              type="color"
              :value="colorToHex(layer.style.line_color)"
              @input="updateGeoJsonStyle(layer.id, { line_color: eventValue($event) })"
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
                @change="toggleGeoJsonCategory(layer.id, category.value)"
              />
              <span class="category-name">{{ category.value }}</span>
              <span class="category-count">{{ category.count }}</span>
            </label>
            <input
              type="color"
              :value="categoryColor(layer, category.value)"
              @input="setGeoJsonCategoryColor(layer.id, category.value, eventValue($event))"
            />
          </div>
        </div>

        <label class="control-row">
          <span>opacity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="layer.style.opacity"
            @input="updateGeoJsonStyle(layer.id, { opacity: eventNumber($event) })"
          />
        </label>
        <label class="control-row">
          <span>line width</span>
          <input
            type="range"
            min="0"
            max="12"
            step="0.5"
            :value="layer.style.line_width"
            @input="updateGeoJsonStyle(layer.id, { line_width: eventNumber($event) })"
          />
        </label>
        <label class="control-row">
          <span>point radius</span>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            :value="layer.style.point_radius"
            @input="updateGeoJsonStyle(layer.id, { point_radius: eventNumber($event) })"
          />
        </label>
        <div class="checkbox-row">
          <label>
            <input
              type="checkbox"
              :checked="layer.style.filled"
              @change="updateGeoJsonStyle(layer.id, { filled: eventChecked($event) })"
            />
            filled
          </label>
          <label>
            <input
              type="checkbox"
              :checked="layer.style.stroked"
              @change="updateGeoJsonStyle(layer.id, { stroked: eventChecked($event) })"
            />
            stroked
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  layers,
  clearLayers,
  removeLayer,
  toggleLayerVisibility,
  parseColor,
  colorToHex,
  updateGeoJsonStyle,
  setGeoJsonCategoryColor,
  toggleGeoJsonCategory,
  type GeoJsonLayerEntry,
  type LayerEntry,
  type StyleOptions
} from "./store";
import { reactive } from "vue";

type GeoJsonFeature = Record<string, unknown> & {
  properties?: Record<string, unknown> | null;
};

interface CategoryStat {
  value: string;
  count: number;
}

const collapsedLayers = reactive(new Set<string>());

const palette = [
  "oklch(54.87% 0.222 260.33)", // uchu blue 5
  "oklch(58.63% 0.231 19.6)", // uchu red 5
  "oklch(75.23% 0.209 144.64)", // uchu green 5
  "oklch(74.61% 0.171 51.56)", // uchu orange 5
  "oklch(49.39% 0.215 298.31)", // uchu purple 5
  "oklch(82.23% 0.112 355.33)", // uchu pink 5
  "oklch(89% 0.146 91.5)", // uchu yellow 5
  "oklch(56.82% 0.004 247.89)" // uchu gray 9
];

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function eventNumber(event: Event): number {
  return Number(eventValue(event));
}

function eventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
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
  const [r, g, b, a] = parseColor(style.fill_color, [128, 128, 128, 255]);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function getLayerStats(layer: LayerEntry): string {
  if (layer.source === "parquet") return `${layer.table.numRows.toLocaleString()} rows`;
  return `${features(layer).length.toLocaleString()} features`;
}

function features(layer: GeoJsonLayerEntry): GeoJsonFeature[] {
  if (layer.data.type === "FeatureCollection" && Array.isArray(layer.data.features)) {
    return layer.data.features.filter(isFeature);
  }
  if (layer.data.type === "Feature" && isFeature(layer.data)) return [layer.data];
  return [];
}

function isFeature(value: unknown): value is GeoJsonFeature {
  return typeof value === "object" && value !== null;
}

function propertyFields(layer: GeoJsonLayerEntry): string[] {
  const names = new Set<string>();
  for (const feature of features(layer)) {
    const properties = feature.properties;
    if (!properties) continue;
    for (const key of Object.keys(properties)) names.add(key);
  }
  return [...names].sort();
}

function categoryStats(layer: GeoJsonLayerEntry): CategoryStat[] {
  return categoryStatsForField(layer, layer.style.category_field);
}

function categoryStatsForField(layer: GeoJsonLayerEntry, field: string): CategoryStat[] {
  if (!field) return [];
  const counts = new Map<string, number>();
  for (const feature of features(layer)) {
    const value = feature.properties?.[field];
    const category = value === undefined || value === null ? "(empty)" : String(value);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function defaultCategoryColor(category: string): string {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function categoryColor(layer: GeoJsonLayerEntry, category: string): string {
  return layer.style.category_colors[category] ?? defaultCategoryColor(category);
}

function colorsForField(layer: GeoJsonLayerEntry, field: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const colorField = layer.style.color_field;

  for (const feature of features(layer)) {
    const categoryValue = feature.properties?.[field];
    const category =
      categoryValue === undefined || categoryValue === null ? "(empty)" : String(categoryValue);
    const colorValue = colorField ? feature.properties?.[colorField] : undefined;
    if (typeof colorValue === "string") colors[category] ??= colorValue;
  }

  for (const stat of categoryStatsForField(layer, field)) {
    colors[stat.value] ??= layer.style.category_colors[stat.value] ?? defaultCategoryColor(stat.value);
  }
  return colors;
}

function setStyleMode(layer: GeoJsonLayerEntry, mode: "single" | "category") {
  if (mode === "single") {
    updateGeoJsonStyle(layer.id, { style_mode: mode });
    return;
  }

  const field = layer.style.category_field || propertyFields(layer)[0] || "";
  updateGeoJsonStyle(layer.id, {
    style_mode: mode,
    category_field: field,
    category_colors: colorsForField(layer, field)
  });
}

function setCategoryField(layer: GeoJsonLayerEntry, field: string) {
  updateGeoJsonStyle(layer.id, {
    category_field: field,
    hidden_categories: {},
    category_colors: colorsForField(layer, field)
  });
}
</script>

<style scoped>
.layer-list {
  display: flex;
  flex-direction: column;
  max-height: 520px;
  overflow-y: auto;
}

.list-actions {
  display: flex;
  justify-content: flex-end;
  padding: 4px 12px;
  border-bottom: 1px solid #eee;
}

.empty-state {
  padding: 1rem;
  text-align: center;
  color: #666;
  font-size: 0.9em;
  font-style: italic;
}

.layer-item {
  padding: 6px 12px;
  border-bottom: 1px solid #eee;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.9em;
}

.layer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.left-col {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.right-col {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.visibility-btn,
.icon-btn,
.text-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: #888;
  display: flex;
  align-items: center;
}

.visibility-btn:hover,
.icon-btn:hover,
.text-btn:hover {
  color: #333;
}

.icon-btn {
  width: 16px;
  justify-content: center;
  font-size: 12px;
}

.text-btn {
  font-size: 0.75em;
  font-family: "B612", sans-serif;
}

.text-btn.danger:hover {
  color: #b91c1c;
}

.layer-label {
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: "B612", sans-serif;
}

.layer-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: #f5f5f5;
  padding: 2px 6px 2px 4px;
  border-radius: 12px;
  border: 1px solid #e0e0e0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.kind-label {
  text-transform: lowercase;
  font-size: 0.75em;
  color: #555;
  font-weight: 600;
  line-height: 1;
}

.layer-stats {
  color: #999;
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
}

.geojson-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: #fafafa;
  border: 1px solid #eee;
}

.control-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
  color: #555;
  font-size: 0.82em;
}

.control-row input[type="color"] {
  width: 100%;
  height: 24px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  padding: 4px 0;
}

.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  align-items: center;
  gap: 8px;
}

.category-visible {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.category-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #333;
}

.category-count {
  margin-left: auto;
  color: #999;
  font-variant-numeric: tabular-nums;
  font-size: 0.8em;
}

.checkbox-row {
  display: flex;
  gap: 12px;
  color: #555;
  font-size: 0.82em;
}
</style>
