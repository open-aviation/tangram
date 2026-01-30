<template>
  <div class="settings-menu-anchor">
    <button class="settings-btn" title="Settings" @click.stop="isOpen = !isOpen">
      <i class="fa fa-cog"></i>
    </button>

    <div v-if="isOpen" class="settings-dropdown" @click.stop>
      <div class="settings-header">
        <span>Settings</span>
        <button class="close-btn" @click="isOpen = false">
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      <div class="settings-content">
        <div
          v-for="pluginName in visiblePluginNames"
          :key="pluginName"
          class="settings-section"
        >
          <div class="section-title">{{ formatPluginName(pluginName) }}</div>

          <template v-for="item in getRenderList(pluginName)" :key="item.key">
            <div v-if="item.type === 'widget'" class="widget-group">
              <component
                :is="getWidgetComponent(item.widget)"
                :model-value="getPluginValue(pluginName, item.key)"
                :schema="item.schema"
                @update:model-value="v => setPluginValue(pluginName, item.key, v)"
              />
            </div>

            <SettingsField
              v-else
              :field-key="item.key"
              :schema="item.schema"
              :model-value="getPluginValue(pluginName, item.key)"
              :errors="getPluginErrors(pluginName)"
              :definitions="getPluginDefinitions(pluginName)"
              parent-path=""
              @update:model-value="v => setPluginValue(pluginName, item.key, v)"
              @change="triggerValidation(pluginName)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, computed } from "vue";
import type { TangramApi } from "./api";
import SettingsField from "./SettingsField.vue";

const api = inject<TangramApi>("tangramApi")!;
const isOpen = ref(false);

const resolveRef = (schema: any, definitions: any) => {
  if (schema.$ref && definitions) {
    const key = schema.$ref.split("/").pop();
    return definitions[key] || schema;
  }
  return schema;
};

const isSchemaVisible = (schema: any, definitions: any): boolean => {
  const s = resolveRef(schema, definitions);
  if (s.tangram_mutable || s.tangram_widget) return true;

  if (s.type === "object" && s.properties) {
    return Object.values(s.properties).some(p => isSchemaVisible(p, definitions));
  }

  if (s.type === "array" && s.items) {
    return isSchemaVisible(s.items, definitions);
  }

  // do we need to handle intersection/union?
  if (s.allOf) return s.allOf.some((sub: any) => isSchemaVisible(sub, definitions));
  if (s.anyOf) return s.anyOf.some((sub: any) => isSchemaVisible(sub, definitions));

  return false;
};

const visiblePluginNames = computed(() => {
  return Object.keys(api.settings).filter(name => {
    const plugin = api.settings[name];
    if (!plugin.schema || !plugin.schema.properties) return false;
    return Object.values(plugin.schema.properties).some(p =>
      isSchemaVisible(p, plugin.schema.$defs)
    );
  });
});

interface RenderItem {
  type: "widget" | "field";
  key: string;
  widget?: string;
  schema: any;
}

const getRenderList = (pluginName: string): RenderItem[] => {
  const plugin = api.settings[pluginName];
  const props = plugin.schema.properties || {};
  const defs = plugin.schema.$defs;
  const list: RenderItem[] = [];
  const seenWidgets = new Set<string>();

  for (const [key, schema] of Object.entries(props)) {
    if (!isSchemaVisible(schema, defs)) continue;

    const resolved = resolveRef(schema, defs);
    if (resolved.tangram_widget) {
      if (seenWidgets.has(resolved.tangram_widget)) continue;
      seenWidgets.add(resolved.tangram_widget);
      list.push({
        type: "widget",
        key,
        widget: resolved.tangram_widget,
        schema: resolved
      });
    } else {
      list.push({ type: "field", key, schema });
    }
  }
  return list;
};

const getWidgetComponent = (name: string) => {
  return api.ui.getSettingsWidget(name) || "div";
};

const getPluginValue = (pluginName: string, key: string) => {
  return api.settings[pluginName].values[key];
};

const setPluginValue = (pluginName: string, key: string, val: any) => {
  api.settings[pluginName].values[key] = val;
  triggerValidation(pluginName);
};

const getPluginErrors = (pluginName: string) => api.settings[pluginName].errors;
const getPluginDefinitions = (pluginName: string) =>
  api.settings[pluginName].schema.$defs;

const formatPluginName = (name: string) => {
  return name.replace(/^tangram_/, "").replace(/^@.*\//, "");
};

let validationTimeout: ReturnType<typeof setTimeout> | null = null;
const triggerValidation = (pluginName: string) => {
  if (validationTimeout) clearTimeout(validationTimeout);
  validationTimeout = setTimeout(async () => {
    const plugin = api.settings[pluginName];
    const body = JSON.stringify(plugin.values);
    try {
      const resp = await fetch(`/settings/validate/${pluginName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const result = await resp.json();
      plugin.errors = result.success ? {} : result.errors;
    } catch (e) {
      console.error("validation failed", e);
    }
  }, 400);
};
</script>

<style scoped>
.settings-menu-anchor {
  position: relative;
}
.settings-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--t-fg);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 4px;
  transition: background-color 0.2s;
}
.settings-btn:hover {
  background-color: var(--t-hover);
}
.settings-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  width: 320px;
  background: var(--t-surface);
  border: 1px solid var(--t-border);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 80px);
  color: var(--t-fg);
  z-index: 5000;
  margin-top: 8px;
}
.settings-header {
  padding: 4px 10px;
  font-weight: 600;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--t-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--t-bg);
  border-radius: 8px 8px 0 0;
}
.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--t-muted);
  display: flex;
  padding: 4px;
}
.close-btn:hover {
  color: var(--t-fg);
}
.settings-content {
  overflow-y: auto;
  padding: 10px;
  background-color: var(--t-bg);
}
.settings-section {
  margin-bottom: 20px;
  border-bottom: 1px solid var(--t-border);
  padding-bottom: 12px;
}
.settings-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.section-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--t-accent1), var(--t-fg));
  margin-bottom: 4px;
  font-weight: 700;
}
.widget-group {
  margin-bottom: 12px;
}
</style>
