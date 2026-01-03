<template>
  <div class="palette-widget" @click.stop>
    <div class="search-box">
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Search (Ctrl+P)..."
        class="search-input"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter="selectCurrent"
        @focus="isOpen = true"
      />
    </div>
    <ul v-if="isOpen && flatResults.length" class="results-list">
      <li
        v-for="(item, index) in flatResults"
        :key="item.id"
        class="result-item"
        :class="{ selected: index === selectedIndex, 'is-child': item.depth > 0 }"
        :style="{ paddingLeft: `${item.depth * 16 + 12}px` }"
        @click="selectResult(item)"
        @mouseenter="selectedIndex = index"
      >
        <component :is="item.component" v-bind="item.props" :query="query" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, inject, watch, computed } from "vue";
import type { TangramApi, SearchResult } from "./api";

const tangramApi = inject<TangramApi>("tangramApi");
const query = ref("");
const results = ref<SearchResult[]>([]);
const selectedIndex = ref(0);
const isOpen = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

let abortController: AbortController | null = null;
let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

interface FlatResult extends SearchResult {
  depth: number;
}

const flatResults = computed(() => {
  const flat: FlatResult[] = [];
  const traverse = (nodes: SearchResult[], depth: number) => {
    for (const node of nodes) {
      flat.push({ ...node, depth });
      if (node.children) {
        traverse(node.children, depth + 1);
      }
    }
  };
  traverse(results.value, 0);
  return flat;
});

const close = () => {
  isOpen.value = false;
  results.value = [];
};

const moveSelection = (delta: number) => {
  if (flatResults.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value + delta + flatResults.value.length) % flatResults.value.length;
};

const selectResult = (result: SearchResult) => {
  if (result.onSelect) {
    result.onSelect();
    close();
    query.value = "";
  }
};

const selectCurrent = () => {
  if (flatResults.value.length > 0) {
    selectResult(flatResults.value[selectedIndex.value]);
  }
};

const performSearch = () => {
  if (!tangramApi) return;
  if (abortController) abortController.abort();
  abortController = new AbortController();

  results.value = [];

  if (!query.value.trim() || query.value.length < 2) {
    return;
  }

  isOpen.value = true;
  tangramApi.search.search(query.value, abortController.signal, newResults => {
    results.value = [...results.value, ...newResults].sort(
      (a, b) => (b.score || 0) - (a.score || 0)
    );
    selectedIndex.value = 0;
  });
};

watch(query, () => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(performSearch, 150);
});

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    inputRef.value?.focus();
  }
  if (e.key === "Escape") {
    inputRef.value?.blur();
    close();
  }
};

const onClickOutside = () => close();

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("click", onClickOutside);
});
</script>

<style scoped>
.palette-widget {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 400px;
  z-index: 2000;
  font-family: "B612", sans-serif;
}

.search-box {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  outline: none;
  font-size: 14px;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: #666;
}

.results-list {
  margin: 4px 0 0 0;
  padding: 0;
  list-style: none;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #eee;
}

.result-item {
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background-color 0.1s;
}

.result-item:last-child {
  border-bottom: none;
}

.result-item.selected,
.result-item:hover {
  background-color: #f8f9fa;
}

.is-child {
  border-left: 2px solid #eee;
}
</style>
