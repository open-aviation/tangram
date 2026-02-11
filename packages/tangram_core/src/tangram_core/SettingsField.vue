<template>
  <div
    v-if="isVisible"
    class="field-wrapper"
    :class="{ 'complex-field': isComplex, 'union-member': isUnionMember }"
  >
    <!-- skip the header if this component is rendering a selected union member 
         because the parent's selector already acts as the label/header. -->
    <div v-if="!props.isUnionMember" class="field-header">
      <div class="field-label" :title="schema.description">
        {{ label }}
      </div>

      <div class="field-control">
        <div v-if="effectiveSchema.tangram_widget" class="widget-container">
          <component
            :is="getWidget(effectiveSchema.tangram_widget)"
            :model-value="modelValue"
            :schema="effectiveSchema"
            @update:model-value="updateValue"
          />
        </div>
        <template v-else>
          <div v-if="isUnion" class="union-selector">
            <select :value="selectedUnionIndex" @change="onUnionChange">
              <option v-for="(opt, idx) in unionOptions" :key="idx" :value="idx">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- inline value controls -->
          <input
            v-if="effectiveSchema.type === 'boolean'"
            type="checkbox"
            :checked="modelValue"
            @change="updateValue(($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="effectiveSchema.enum"
            :value="modelValue"
            @change="updateValue(($event.target as HTMLInputElement).value)"
          >
            <option v-for="val in effectiveSchema.enum" :key="val" :value="val">
              {{ val }}
            </option>
          </select>
          <ColorPicker
            v-else-if="effectiveSchema.tangram_kind === 'color'"
            :model-value="modelValue"
            @update:model-value="updateValue"
          />
          <input
            v-else-if="
              effectiveSchema.type === 'number' || effectiveSchema.type === 'integer'
            "
            type="number"
            :value="modelValue"
            :min="effectiveSchema.minimum"
            :max="effectiveSchema.maximum"
            @input="updateValue(Number(($event.target as HTMLInputElement).value))"
          />
          <input
            v-else-if="effectiveSchema.type === 'string'"
            type="text"
            :value="modelValue"
            class="input-text"
            @input="updateValue(($event.target as HTMLInputElement).value)"
          />
          <span v-else-if="effectiveSchema.type === 'null'" class="null-indicator">
            None
          </span>
        </template>
      </div>
    </div>

    <!-- if isUnionMember, we use a different class to avoid double padding/border 
         since the parent container already provides structural nesting. -->
    <div
      v-if="isComplex && !effectiveSchema.tangram_widget"
      :class="isUnionMember ? 'union-body' : 'field-body'"
    >
      <div v-if="isUnion">
        <!-- simple types were handled inline in the header and thus need no recursion. -->
        <SettingsField
          v-if="isSchemaComplex(effectiveSchema)"
          :schema="effectiveSchema"
          :model-value="modelValue"
          :definitions="definitions"
          :errors="errors"
          :parent-path="currentPath"
          :is-union-member="true"
          @update:model-value="updateValue"
          @change="$emit('change')"
        />
      </div>

      <div v-else-if="effectiveSchema.type === 'object' && effectiveSchema.properties">
        <template v-for="item in renderList" :key="item.key">
          <div v-if="item.type === 'widget'" class="nested-widget">
            <component
              :is="getWidget(item.widget!)"
              :model-value="modelValue?.[item.key]"
              :schema="item.schema"
              @update:model-value="v => updateNested(item.key, v)"
            />
          </div>
          <SettingsField
            v-else
            :field-key="item.key"
            :schema="item.schema"
            :model-value="modelValue?.[item.key]"
            :errors="errors"
            :definitions="definitions"
            :parent-path="currentPath"
            @update:model-value="v => updateNested(item.key, v)"
            @change="$emit('change')"
          />
        </template>
      </div>

      <div v-else-if="effectiveSchema.type === 'array'">
        <div v-for="(item, idx) in modelValue" :key="idx" class="array-item">
          <div class="array-index">{{ idx }}</div>
          <SettingsField
            :schema="effectiveSchema.items || {}"
            :model-value="item"
            :definitions="definitions"
            :errors="errors"
            :parent-path="`${currentPath}[${idx}]`"
            @update:model-value="v => updateArrayItem(idx as number, v)"
            @change="$emit('change')"
          />
        </div>
        <div v-if="!modelValue || modelValue.length === 0" class="empty-msg">
          Empty list
        </div>
      </div>
    </div>

    <div v-if="errorMessage" class="error-msg">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { TangramApi, JsonSchema } from "./api";
import ColorPicker from "./ColorPicker.vue";

const props = defineProps<{
  fieldKey?: string;
  schema: JsonSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelValue: any;
  definitions?: Record<string, JsonSchema>;
  errors?: Record<string, string>;
  parentPath?: string;
  // if true, we skip the label/header because the union selector acts as header
  isUnionMember?: boolean;
}>();

const emit = defineEmits(["update:modelValue", "change"]);
const api = inject<TangramApi>("tangramApi");

const resolveRef = (s: JsonSchema): JsonSchema => {
  if (s && s.$ref && props.definitions) {
    const key = s.$ref.split("/").pop();
    if (key && props.definitions[key]) return props.definitions[key];
  }
  return s || {};
};
const getWidget = (name: string) => api?.ui.getSettingsWidget(name) || "div";
const resolvedBaseSchema = computed(() => resolveRef(props.schema));
const isVisible = computed(() => {
  if (props.isUnionMember) return true; // always show if we are the body of a union selection
  return checkVisibility(resolvedBaseSchema.value);
});
function checkVisibility(s: JsonSchema): boolean {
  s = resolveRef(s);
  if (s.tangram_mutable || s.tangram_widget) return true;
  if (s.type === "object" && s.properties) {
    return Object.values(s.properties).some((p: JsonSchema) => checkVisibility(p));
  }
  if (s.type === "array" && s.items) return checkVisibility(s.items as JsonSchema);
  if (s.anyOf) return s.anyOf.some((sub: JsonSchema) => checkVisibility(sub));
  return false;
}

// TODO: unions / enums are still WIP and extremely rough, refactor
const isUnion = computed(() => !!resolvedBaseSchema.value.anyOf);
const unionOptions = computed(() => {
  if (!isUnion.value) return [];
  return (resolvedBaseSchema.value.anyOf as JsonSchema[]).map(
    (sub: JsonSchema, idx: number) => {
      const r = resolveRef(sub);
      let label = (r.title as string) || (r.type as string) || `Option ${idx + 1}`;
      if (r.const !== undefined) label = String(r.const);
      return { label, schema: sub, index: idx };
    }
  );
});

const selectedUnionIndex = ref(0);
watch(
  () => props.modelValue,
  val => {
    if (!isUnion.value) return;
    // heuristic for now
    const idx = unionOptions.value.findIndex((opt: { schema: JsonSchema }) => {
      const s = resolveRef(opt.schema);
      if (s.const !== undefined) return s.const === val;
      if (s.type === "null") return val === null;
      const valType = typeof val;
      if (s.type === (valType as string)) {
        if (s.type === "object" && val !== null && !Array.isArray(val)) return true;
        if (Array.isArray(val) && (s.type as string) === "array") return true;
        if (s.type !== "object" && (s.type as string) !== "array") return true;
      }
      return false;
    });
    if (idx !== -1) selectedUnionIndex.value = idx;
  },
  { immediate: true }
);
const effectiveSchema = computed(() => {
  if (isUnion.value) {
    const sub = unionOptions.value[selectedUnionIndex.value]?.schema;
    return resolveRef(sub);
  }
  return resolvedBaseSchema.value;
});

const isComplex = computed(() => isSchemaComplex(effectiveSchema.value));
function isSchemaComplex(s: JsonSchema): boolean {
  s = resolveRef(s);
  if (s.tangram_widget) return false;
  // widgets handle their own layout, treated as block but not "nested" in this component's sense
  // unions are complex if they switch between things, but we handle the selector inline.
  // the BODY is complex if the selected member is complex.
  if (s.type === "object" || s.properties) return true;
  if (s.type === "array") return true;
  return false;
}

const label = computed(() => {
  if (props.isUnionMember) return ""; // handled by parent selector
  return (resolvedBaseSchema.value.title as string) || props.fieldKey || "Field";
});
const currentPath = computed(() => {
  if (!props.fieldKey) return props.parentPath || "";
  return props.parentPath ? `${props.parentPath}.${props.fieldKey}` : props.fieldKey;
});
const errorMessage = computed(() => props.errors?.[currentPath.value]);

const renderList = computed(() => {
  const propsMap =
    (effectiveSchema.value.properties as Record<string, JsonSchema>) || {};
  const list: {
    type: "widget" | "field";
    key: string;
    widget?: string;
    schema: JsonSchema;
  }[] = [];
  const seenWidgets = new Set<string>();

  for (const [key, subSchema] of Object.entries(propsMap)) {
    if (!checkVisibility(subSchema)) continue;

    const r = resolveRef(subSchema);
    if (r.tangram_widget) {
      if (seenWidgets.has(r.tangram_widget as string)) continue;
      seenWidgets.add(r.tangram_widget as string);
      list.push({ type: "widget", key, widget: r.tangram_widget as string, schema: r });
    } else {
      list.push({ type: "field", key, schema: subSchema });
    }
  }
  return list;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateValue = (val: any) => {
  emit("update:modelValue", val);
  emit("change");
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateNested = (key: string, val: any) => {
  const newVal = { ...props.modelValue, [key]: val };
  emit("update:modelValue", newVal);
  emit("change");
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateArrayItem = (idx: number, val: any) => {
  const arr = [...(props.modelValue || [])];
  arr[idx] = val;
  emit("update:modelValue", arr);
  emit("change");
};

const onUnionChange = (e: Event) => {
  const idx = Number((e.target as HTMLSelectElement).value);
  selectedUnionIndex.value = idx;

  const newSchema = resolveRef(unionOptions.value[idx].schema);
  const defaultVal = getDefaultValue(newSchema);
  updateValue(defaultVal);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDefaultValue(s: JsonSchema): any {
  s = resolveRef(s);
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.type === "boolean") return false;
  if (s.type === "string") return s.tangram_kind === "color" ? "#000000" : "";
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "array") return [];
  if (s.type === "object") return {}; // should probably construct recursively if required fields exist
  if (s.type === "null") return null;
  return null;
}
</script>

<style scoped>
.field-wrapper {
  margin-bottom: 8px;
  font-size: 0.8rem;
  color: var(--t-fg);
}

.union-member {
  margin-bottom: 0;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
}

.field-label {
  flex: 0 0 110px;
  word-break: break-word;
  line-height: 1.2;
}

.field-control {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.field-control > input,
.field-control > select,
.widget-container {
  width: 100%;
}
.union-selector {
  flex: 1 1 auto;
  min-width: 80px;
}

input[type="text"],
input[type="number"],
select {
  background: var(--t-bg);
  color: var(--t-fg);
  border: 1px solid var(--t-border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: inherit;
  font-family: inherit;
}

input[type="checkbox"] {
  accent-color: var(--t-accent1);
  width: auto;
}

.field-body {
  margin-top: 6px;
  padding-left: 8px;
  border-left: 1px dashed var(--t-border);
}

.union-body {
  margin-top: 0;
  padding-left: 0;
  border-left: none;
}

.complex-field > .field-header .field-control {
  flex-grow: 1;
  width: auto;
  min-width: 100px;
}

.array-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--t-border);
  padding-bottom: 8px;
}
.array-index {
  font-family: monospace;
  opacity: 0.5;
  padding-top: 5px;
}
.array-item:last-child {
  border-bottom: none;
}
.empty-msg {
  font-style: italic;
  opacity: 0.6;
}

.error-msg {
  color: var(--t-error);
  font-size: 0.75rem;
  text-align: right;
  margin-top: 2px;
}

.nested-widget {
  margin-bottom: 8px;
}
</style>
