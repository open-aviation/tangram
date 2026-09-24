<template>
  <div class="settings-menu-anchor">
    <IconButton title="Settings" aria-label="Settings" @click.stop="isOpen = !isOpen">
      <SvgIcon :path="ICON_PATHS.settings" />
    </IconButton>

    <div v-if="isOpen" class="settings-dropdown" @click.stop>
      <div class="settings-header">
        <span>Settings</span>
        <IconButton
          title="Close settings"
          aria-label="Close settings"
          size="xs"
          variant="plain"
          muted
          @click="isOpen = false"
        >
          <SvgIcon :path="ICON_PATHS.close" />
        </IconButton>
      </div>
      <div class="settings-content">
        <div
          v-for="pluginId in visiblePluginIds"
          :key="pluginId"
          class="settings-section"
        >
          <div class="section-title">{{ formatPluginId(pluginId) }}</div>

          <template v-for="item in getRenderList(pluginId)" :key="item.key">
            <div v-if="item.type === 'widget'" class="widget-group">
              <component
                :is="getWidgetComponent(item.widget!)"
                :model-value="getPluginValue(pluginId, item.key)"
                :schema="item.schema"
                @update:model-value="
                  (v: unknown) => setPluginValue(pluginId, item.key, v)
                "
              />
            </div>

            <SettingsField
              v-else
              :field-key="item.key"
              :schema="item.schema"
              :model-value="getPluginValue(pluginId, item.key)"
              :errors="getPluginErrors(pluginId)"
              :definitions="getPluginDefinitions(pluginId)"
              parent-path=""
              @update:model-value="v => setPluginValue(pluginId, item.key, v)"
              @change="triggerValidation(pluginId)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, computed } from "vue";
import type { TangramApi, JsonSchema } from "./api";
import IconButton from "./IconButton.vue";
import SvgIcon from "./SvgIcon.vue";
import { ICON_PATHS } from "./utils";
import SettingsField from "./SettingsField.vue";

const api = inject<TangramApi>("tangramApi")!;
const isOpen = ref(false);

const resolveRef = (
  schema: JsonSchema,
  definitions: Record<string, JsonSchema> | undefined
): JsonSchema => {
  if (schema.$ref && definitions) {
    const key = schema.$ref.split("/").pop();
    if (key && definitions[key]) return definitions[key];
  }
  return schema;
};

const isSchemaVisible = (
  schema: JsonSchema,
  definitions: Record<string, JsonSchema> | undefined
): boolean => {
  const s = resolveRef(schema, definitions);
  if (s.tangram_mutable || s.tangram_widget) return true;

  if (s.type === "object" && s.properties) {
    return Object.values(s.properties).some((p: JsonSchema) =>
      isSchemaVisible(p, definitions)
    );
  }

  if (s.type === "array" && s.items) {
    return isSchemaVisible(s.items as JsonSchema, definitions);
  }

  // do we need to handle intersection/union?
  if (s.allOf)
    return (s.allOf as JsonSchema[]).some((sub: JsonSchema) =>
      isSchemaVisible(sub, definitions)
    );
  if (s.anyOf)
    return (s.anyOf as JsonSchema[]).some((sub: JsonSchema) =>
      isSchemaVisible(sub, definitions)
    );

  return false;
};

const visiblePluginIds = computed(() => {
  return Object.keys(api.settings).filter(name => {
    const plugin = api.settings[name];
    if (!plugin.schema || !plugin.schema.properties) return false;
    return Object.values(plugin.schema.properties as Record<string, JsonSchema>).some(
      (p: JsonSchema) =>
        isSchemaVisible(p, plugin.schema.$defs as Record<string, JsonSchema>)
    );
  });
});

interface RenderItem {
  type: "widget" | "field";
  key: string;
  widget?: string;
  schema: JsonSchema;
}

const getRenderList = (pluginId: string): RenderItem[] => {
  const plugin = api.settings[pluginId];
  const props = (plugin.schema.properties as Record<string, JsonSchema>) || {};
  const defs = plugin.schema.$defs as Record<string, JsonSchema>;
  const list: RenderItem[] = [];
  const seenWidgets = new Set<string>();

  for (const [key, schema] of Object.entries(props)) {
    if (!isSchemaVisible(schema, defs)) continue;

    const resolved = resolveRef(schema, defs);
    if (resolved.tangram_widget) {
      if (seenWidgets.has(resolved.tangram_widget as string)) continue;
      seenWidgets.add(resolved.tangram_widget as string);
      list.push({
        type: "widget",
        key,
        widget: resolved.tangram_widget as string,
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

const getPluginValue = (pluginId: string, key: string) => {
  return api.settings[pluginId].values[key];
};

const setPluginValue = (pluginId: string, key: string, val: unknown) => {
  api.settings[pluginId].values[key] = val;
  triggerValidation(pluginId);
};

const getPluginErrors = (pluginId: string) => api.settings[pluginId].errors;
const getPluginDefinitions = (pluginId: string) => api.settings[pluginId].schema.$defs;

const formatPluginId = (name: string) => {
  return name.replace(/^tangram_/, "").replace(/^@.*\//, "");
};

let validationTimeout: ReturnType<typeof setTimeout> | null = null;
const triggerValidation = (pluginId: string) => {
  if (validationTimeout) clearTimeout(validationTimeout);
  validationTimeout = setTimeout(async () => {
    const plugin = api.settings[pluginId];
    const body = JSON.stringify(plugin.values);
    try {
      const resp = await fetch(`/settings/validate/${pluginId}`, {
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
