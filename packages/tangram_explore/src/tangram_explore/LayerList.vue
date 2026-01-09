<template>
  <div class="layer-list">
    <div v-if="layers.length === 0" class="empty-state">no active layers</div>
    <div v-for="layer in layers" :key="layer.id" class="layer-item">
      <div class="left-col">
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
        <span class="layer-stats">{{ layer.table.numRows.toLocaleString() }} rows</span>
        <div class="layer-chip">
          <div
            class="status-dot"
            :style="{ backgroundColor: getLayerColor(layer.style) }"
          ></div>
          <span class="kind-label">{{ layer.style.kind }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { layers, toggleLayerVisibility, parseColor, type StyleOptions } from "./store";

function getLayerColor(style: StyleOptions): string {
  let c;
  if (style.kind === "scatter") {
    c = style.fill_color;
  } else {
    c = [128, 128, 128];
  }
  const [r, g, b, a] = parseColor(c, [128, 128, 128, 255]);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
</script>

<style scoped>
.layer-list {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow-y: auto;
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
  justify-content: space-between;
  align-items: center;
  font-size: 0.9em;
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

.visibility-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: #888;
  display: flex;
  align-items: center;
}

.visibility-btn:hover {
  color: #333;
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
</style>
