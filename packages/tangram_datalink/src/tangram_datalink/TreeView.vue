<template>
  <div class="tree-view">
    <template v-if="isObject(data)">
      <div v-if="Object.keys(data).length === 0" class="tree-row">
        <span class="tree-val null">{}</span>
      </div>
      <div v-for="(val, key) in data" :key="key" class="tree-row">
        <span class="tree-key">{{ key }}:</span>
        <span v-if="val === null" class="tree-val null">null</span>
        <TreeView v-else-if="isComplex(val)" :data="val" class="tree-child" />
        <span v-else-if="isObject(val)" class="tree-val null">{}</span>
        <span v-else class="tree-val">{{ String(val) }}</span>
      </div>
    </template>
    <template v-else-if="Array.isArray(data)">
      <div v-if="data.length === 0" class="tree-row">
        <span class="tree-val null">[]</span>
      </div>
      <div v-for="(val, idx) in data" :key="idx" class="tree-row">
        <span class="tree-key">[{{ idx }}]</span>
        <span v-if="val === null" class="tree-val null">null</span>
        <TreeView v-else-if="isComplex(val)" :data="val" class="tree-child" />
        <span v-else-if="isObject(val)" class="tree-val null">{}</span>
        <span v-else class="tree-val">{{ String(val) }}</span>
      </div>
    </template>
    <span v-else-if="data === null" class="tree-val null">null</span>
    <span v-else class="tree-val">{{ String(data) }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ data: unknown }>();
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isComplex = (v: unknown): v is object =>
  v !== null && typeof v === "object" && Object.keys(v).length > 0;
</script>

<style scoped>
.tree-view {
  font-family: "Inconsolata", monospace;
  line-height: 1.3;
}
.tree-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 0px;
}
.tree-child {
  flex: 1 1 100%;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--t-border) 60%, transparent);
  margin-left: 4px;
  margin-top: 1px;
}
.tree-key {
  color: color-mix(in srgb, var(--t-fg) 70%, transparent);
  margin-right: 4px;
  font-weight: 500;
}
.tree-val {
  color: var(--t-fg);
  word-break: break-word;
}
.tree-val.null {
  color: var(--t-muted);
  font-style: italic;
}
</style>
