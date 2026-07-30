<template>
  <div class="map-settings">
    <div class="section">
      <div class="section-header">Base Style</div>
      <select :value="styleReference(modelValue)" @change="onStyleChange">
        <option v-for="(opt, idx) in styleOptions" :key="idx" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <!-- at this stage we don't allow users to add/remove/edit layers, just show them -->
    <div class="section">
      <div class="section-header">Visible Layers</div>
      <div class="layers-list">
        <div v-for="(layer, id) in mapLayers" :key="id" class="layer-item">
          <div class="layer-row">
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="layer.visible"
                @change="
                  api.map.setMapLayerVisibility(
                    String(id),
                    ($event.target as HTMLInputElement).checked
                  )
                "
              />
              <span class="layer-id" :title="String(id)">{{ id }}</span>
            </label>
            <div class="layer-meta">
              <span class="layer-type">{{ layer.type }}</span>
              <span
                v-if="layer.color"
                class="swatch"
                :style="{ backgroundColor: layer.color }"
              ></span>
            </div>
          </div>
          <div v-if="layer.filter" class="layer-filter" :title="layer.filter">
            {{ layer.filter }}
          </div>
        </div>
        <div v-if="Object.keys(mapLayers).length === 0" class="empty-msg">
          No toggleable layers found
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import type { TangramApi } from "./api";

const props = defineProps<{
  modelValue: unknown;
}>();

const emit = defineEmits(["update:modelValue"]);
const api = inject<TangramApi>("tangramApi")!;

const availableStyles = computed(() => {
  return api.settings.tangram_core?.values.map?.styles || [];
});

type StyleOption = { label: string; value: unknown; priority: number };

const styleOptions = computed(() => {
  const uniqueOpts = new Map<string, StyleOption>();
  availableStyles.value.forEach((style: unknown, idx: number) => {
    const value = styleReference(style);
    const key = styleOptionKey(value);
    const option = {
      label: getStyleLabel(style, idx),
      value,
      priority: styleReferencePriority(style)
    };
    const existing = uniqueOpts.get(key);
    if (!existing || existing.priority < option.priority) uniqueOpts.set(key, option);
  });
  return Array.from(uniqueOpts.values(), ({ label, value }) => ({ label, value }));
});

onMounted(() => {
  const currentValue = styleReference(props.modelValue);
  const currentKey = styleOptionKey(currentValue);
  const exists = styleOptions.value.some(
    (option: { value: unknown }) => styleOptionKey(option.value) === currentKey
  );

  if (!exists && props.modelValue) {
    (api.settings.tangram_core.values.map.styles as unknown[]).push(props.modelValue);
  }
});

const mapLayers = computed(() => {
  const visibility = api.map.mapLayerVisibility;
  const style = api.map.styleJson.value;
  if (!style) return {};

  const layers: Record<
    string,
    { visible: boolean; type: string; color?: string; filter?: string }
  > = {};

  if (!style.layers) return layers;
  style.layers.forEach(l => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paint = (l.paint || {}) as any;
    let color = undefined;
    if (paint["fill-color"]) color = paint["fill-color"];
    else if (paint["line-color"]) color = paint["line-color"];
    else if (paint["circle-color"]) color = paint["circle-color"];
    else if (paint["text-color"]) color = paint["text-color"];
    else if (paint["background-color"]) color = paint["background-color"];

    if (typeof color !== "string") color = undefined;

    const filter = "filter" in l ? l.filter : undefined;
    layers[l.id] = {
      visible: visibility[l.id] ?? l.layout?.visibility !== "none",
      type: l.type,
      color,
      filter: filter ? JSON.stringify(filter) : undefined
    };
  });
  return layers;
});

function styleOptionKey(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

function styleReference(style: unknown): unknown {
  if (typeof style !== "object" || style === null) return style;
  const preset = style as { id?: unknown; name?: unknown };
  if (typeof preset.id === "string") return preset.id;
  if (typeof preset.name === "string") return preset.name;
  return style;
}

function styleReferencePriority(style: unknown): number {
  if (typeof style !== "object" || style === null) return 0;
  const preset = style as { id?: unknown; name?: unknown };
  if (typeof preset.id === "string") return 2;
  if (typeof preset.name === "string") return 1;
  return 0;
}

function getStyleLabel(style: unknown, idx?: number): string {
  if (typeof style === "string") {
    try {
      const url = new URL(style);
      const pathname = url.pathname;
      const parts = pathname.split("/").filter(p => p);
      const last = parts[parts.length - 1];
      if (last === "style.json" && parts.length > 1) {
        return parts[parts.length - 2];
      }
      return last;
    } catch {
      const parts = style.split("/");
      return parts[parts.length - 1] || style;
    }
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (style as any)?.name || (idx !== undefined ? `Style ${idx + 1}` : "Unnamed Style")
  );
}

const onStyleChange = (e: Event) => {
  const idx = (e.target as HTMLSelectElement).selectedIndex;
  if (idx < styleOptions.value.length) {
    emit("update:modelValue", styleOptions.value[idx].value);
  }
};
</script>

<style scoped>
.map-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  font-size: 0.8rem;
  color: var(--t-fg);
  margin-bottom: 6px;
}

select {
  background: var(--t-bg);
  color: var(--t-fg);
  border: 1px solid var(--t-border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 0.8rem;
  width: 100%;
}

.layers-list {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid var(--t-border);
  border-radius: 4px;
  padding: 4px;
  background: var(--t-bg);
}

.layer-item {
  padding: 4px 0;
  border-bottom: 1px solid var(--t-border);
}
.layer-item:last-child {
  border-bottom: none;
}

.layer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
  color: var(--t-fg);
  overflow: hidden;
}

.layer-id {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layer-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--t-muted);
  flex-shrink: 0;
}

.layer-type {
  font-family: monospace;
  background: var(--t-surface);
  padding: 1px 3px;
  border-radius: 2px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.layer-filter {
  font-size: 0.65rem;
  color: var(--t-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 30px;
  opacity: 0.7;
}

input[type="checkbox"] {
  accent-color: var(--t-accent1);
}

.empty-msg {
  font-size: 0.8rem;
  color: var(--t-muted);
  font-style: italic;
  padding: 4px;
}
</style>
