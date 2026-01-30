<template>
  <div class="theme-settings">
    <div class="section">
      <div class="section-header">Active Theme</div>
      <select :value="mode" class="mode-select" @change="onModeChange">
        <option value="adaptive">Adaptive (System)</option>
        <option v-for="t in themeNames" :key="t" :value="t">{{ t }}</option>
      </select>

      <div v-if="mode === 'adaptive'" class="sub-selectors">
        <div class="row">
          <label>Light:</label>
          <select
            :value="adaptiveValue.light"
            @change="
              e => updateAdaptive('light', (e.target as HTMLSelectElement).value)
            "
          >
            <option v-for="t in themeNames" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="row">
          <label>Dark:</label>
          <select
            :value="adaptiveValue.dark"
            @change="e => updateAdaptive('dark', (e.target as HTMLSelectElement).value)"
          >
            <option v-for="t in themeNames" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">Available Themes</div>
      <div class="theme-list">
        <div
          v-for="(theme, index) in themes"
          :key="theme.name"
          class="theme-item"
          :class="{ active: isThemeActive(theme.name) }"
        >
          <div class="theme-header">
            <div class="theme-info" @click="setTheme(theme.name)">
              <span class="theme-name">{{ theme.name }}</span>
              <div
                class="theme-preview-box"
                :style="{
                  backgroundColor: theme.background,
                  color: theme.foreground,
                  borderColor: theme.border
                }"
              >
                <span class="preview-text">:D</span>
                <span class="swatch" :style="{ background: theme.accent1 }"></span>
                <span class="swatch" :style="{ background: theme.accent2 }"></span>
              </div>
            </div>
            <button
              class="edit-btn"
              title="Edit Theme Colors"
              @click.stop="toggleEdit(theme.name)"
            >
              <i class="fa fa-pencil"></i>
            </button>
          </div>

          <div v-if="editingTheme === theme.name" class="theme-editor">
            <div
              v-for="(color, key) in filterColors(theme)"
              :key="key"
              class="color-row"
            >
              <label>{{ formatKey(key) }}</label>
              <ColorPicker
                :model-value="color"
                @update:model-value="v => updateThemeColor(index, key, v)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { TangramApi, ThemeDefinition } from "./api";
import ColorPicker from "./ColorPicker.vue";

const props = defineProps<{
  modelValue: string | { light: string; dark: string };
}>();

const emit = defineEmits(["update:modelValue"]);
const api = inject<TangramApi>("tangramApi")!;

const editingTheme = ref<string | null>(null);

const themes = computed(() => {
  return (api.settings.tangram_core?.values.core?.themes as ThemeDefinition[]) || [];
});

const themeNames = computed(() => themes.value.map(d => d.name));

const mode = computed(() => {
  if (typeof props.modelValue === "string") {
    return props.modelValue;
  }
  return "adaptive";
});

const adaptiveValue = computed(() => {
  if (typeof props.modelValue !== "string") return props.modelValue;
  return { light: "light", dark: "dark" };
});

const isThemeActive = (name: string) => {
  if (typeof props.modelValue === "string") return props.modelValue === name;
  return adaptiveValue.value.light === name || adaptiveValue.value.dark === name;
};

const onModeChange = (e: Event) => {
  const newMode = (e.target as HTMLSelectElement).value;
  if (newMode === "adaptive") {
    emit("update:modelValue", { light: "light", dark: "dark" });
  } else {
    emit("update:modelValue", newMode);
  }
};

const setTheme = (name: string) => {
  emit("update:modelValue", name);
};

const updateAdaptive = (key: "light" | "dark", val: string) => {
  if (typeof props.modelValue === "string") return;
  emit("update:modelValue", { ...props.modelValue, [key]: val });
};

const toggleEdit = (name: string) => {
  editingTheme.value = editingTheme.value === name ? null : name;
};

const filterColors = (theme: ThemeDefinition) => {
  const { name, ...colors } = theme; // eslint-disable-line @typescript-eslint/no-unused-vars
  return colors as Record<string, string>;
};

const formatKey = (key: string) => {
  return key.replace(/_/g, " ").replace("color", "");
};

const updateThemeColor = (index: number, key: string, value: string) => {
  if (!api.settings.tangram_core) return;
  api.settings.tangram_core.values.core.themes[index][key] = value;
};
</script>

<style scoped>
.theme-settings {
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

.sub-selectors {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--t-border);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row label {
  font-size: 0.75rem;
  color: var(--t-muted);
  width: 40px;
}

.theme-list {
  border: 1px solid var(--t-border);
  border-radius: 4px;
  overflow: hidden;
}

.theme-item {
  border-bottom: 1px solid var(--t-border);
}

.theme-item:last-child {
  border-bottom: none;
}

.theme-header {
  padding: 6px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--t-bg);
  transition: background-color 0.2s;
}

.theme-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
}

.theme-header:hover {
  background: var(--t-hover);
}

.theme-item.active .theme-header {
  border-left: 3px solid var(--t-accent1);
}

.theme-name {
  font-size: 0.8rem;
  font-weight: 500;
}

.theme-preview-box {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 0.7rem;
}

.preview-text {
  margin-right: 4px;
  font-weight: 700;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.theme-editor {
  padding: 8px;
  background: var(--t-surface);
  border-top: 1px solid var(--t-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.color-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.color-row label {
  font-size: 0.75rem;
  color: var(--t-muted);
  text-transform: capitalize;
}

.edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--t-muted);
  padding: 4px;
  border-radius: 4px;
}

.edit-btn:hover {
  background-color: var(--t-surface);
  color: var(--t-fg);
}
</style>
