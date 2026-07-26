<template>
  <div class="palette-widget" @click.stop>
    <div class="search-box">
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Search (Ctrl+P)..."
        class="search-input"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="tangram-search-results"
        :aria-expanded="isOpen && flatResults.length > 0"
        :aria-activedescendant="activeDescendant"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter="selectCurrent"
        @focus="open"
      />
    </div>
    <ul
      v-if="isOpen && flatResults.length"
      id="tangram-search-results"
      class="results-list"
      role="listbox"
    >
      <li
        v-for="(item, index) in flatResults"
        :id="`tangram-search-result-${index}`"
        :key="resultIdentity(item)"
        :ref="element => setRowRef(item, element)"
        class="result-item"
        :class="{
          selected: isSelectedResult(item),
          'is-child': item.depth > 0,
          'is-structural': !item.onSelect
        }"
        :style="{ paddingLeft: `${item.depth * 16 + 12}px` }"
        :role="item.onSelect ? 'option' : 'presentation'"
        :aria-selected="item.onSelect ? isSelectedResult(item) : undefined"
        @click="selectResult(item)"
        @pointerenter="selectPointerResult(item)"
      >
        <component :is="item.component" v-bind="item.props" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance
} from "vue";
import type { SearchResult, TangramApi } from "./api";

const tangramApi = inject<TangramApi>("tangramApi");
const query = ref("");

type OwnedSearchResult = Omit<SearchResult, "children"> & {
  providerId: string;
  children?: OwnedSearchResult[];
};

interface FlatResult extends OwnedSearchResult {
  depth: number;
}

interface SearchSession {
  query: string;
  controller: AbortController;
}

const results = ref<OwnedSearchResult[]>([]);
const selectedKey = ref<string | null>(null);
const isOpen = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const rowRefs = new Map<string, HTMLElement>();

let session: SearchSession | null = null;
let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

function ownResult(result: SearchResult, providerId: string): OwnedSearchResult {
  return {
    ...result,
    providerId,
    children: result.children?.map(child => ownResult(child, providerId))
  };
}

function flattenResults(nodes: OwnedSearchResult[], depth = 0): FlatResult[] {
  return nodes.flatMap(node => [
    { ...node, depth },
    ...flattenResults(node.children ?? [], depth + 1)
  ]);
}

const flatResults = computed(() => flattenResults(results.value));
// parent results may be structural group labels and must not enter combobox selection
const actionableResults = computed(() =>
  flatResults.value.filter(result => result.onSelect !== undefined)
);

function resultIdentity(result: OwnedSearchResult): string {
  return `${result.providerId}:${result.id}`;
}

function isSelectedResult(result: OwnedSearchResult): boolean {
  return resultIdentity(result) === selectedKey.value;
}

const selectedResult = computed(() =>
  actionableResults.value.find(result => isSelectedResult(result))
);
const selectedFlatIndex = computed(() =>
  flatResults.value.findIndex(result => isSelectedResult(result))
);
const activeDescendant = computed(() =>
  selectedFlatIndex.value >= 0
    ? `tangram-search-result-${selectedFlatIndex.value}`
    : undefined
);

function setRowRef(
  result: OwnedSearchResult,
  element: Element | ComponentPublicInstance | null
): void {
  const key = resultIdentity(result);
  if (element instanceof HTMLElement) rowRefs.set(key, element);
  else rowRefs.delete(key);
}

function selectPointerResult(result: OwnedSearchResult): void {
  if (!result.onSelect) return;
  selectedKey.value = resultIdentity(result);
}

function stopSearch(): void {
  session?.controller.abort();
  session = null;
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = null;
}

function clearResults(): void {
  results.value = [];
  selectedKey.value = null;
}

function restartSearch(delay: number): void {
  stopSearch();
  clearResults();
  if (query.value.trim().length < 2) return;
  if (delay === 0) {
    performSearch();
    return;
  }
  debounceTimeout = setTimeout(() => {
    debounceTimeout = null;
    performSearch();
  }, delay);
}

function open(): void {
  isOpen.value = true;
  if (query.value.trim().length >= 2 && results.value.length === 0 && !session) {
    restartSearch(0);
  }
}

function close(): void {
  stopSearch();
  clearResults();
  isOpen.value = false;
}

function scrollSelectedIntoView(): void {
  void nextTick(() => {
    const key = selectedKey.value;
    if (key) rowRefs.get(key)?.scrollIntoView({ block: "nearest" });
  });
}

function moveSelection(delta: number): void {
  const items = actionableResults.value;
  if (items.length === 0) return;
  const current = items.findIndex(result => isSelectedResult(result));
  const index =
    current === -1
      ? delta > 0
        ? 0
        : items.length - 1
      : (current + delta + items.length) % items.length;
  selectedKey.value = resultIdentity(items[index]);
  scrollSelectedIntoView();
}

function selectResult(result: SearchResult): void {
  if (!result.onSelect) return;
  result.onSelect();
  close();
  query.value = "";
}

function selectCurrent(): void {
  if (selectedResult.value) selectResult(selectedResult.value);
}

function mergeResults(providerId: string, newResults: SearchResult[]): void {
  results.value = [
    ...results.value,
    ...newResults.map(result => ownResult(result, providerId))
  ].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const items = actionableResults.value;
  const selectionExists =
    !!selectedKey.value && items.some(result => isSelectedResult(result));
  if (!selectionExists) {
    selectedKey.value = items[0] ? resultIdentity(items[0]) : null;
  }
}

function performSearch(): void {
  if (!tangramApi) return;
  const searchQuery = query.value;
  if (searchQuery.trim().length < 2) return;

  const current: SearchSession = {
    query: searchQuery,
    controller: new AbortController()
  };
  session = current;
  isOpen.value = true;

  void tangramApi.search
    .search(searchQuery, current.controller.signal, (providerId, newResults) => {
      if (
        session !== current ||
        current.controller.signal.aborted ||
        !isOpen.value ||
        query.value !== current.query
      ) {
        return;
      }
      mergeResults(providerId, newResults);
    })
    .finally(() => {
      if (session === current) session = null;
    });
}

if (tangramApi) {
  watch(tangramApi.search.revision, () => {
    // registry changes restart the query so every row belongs to one provider snapshot
    if (isOpen.value && query.value.trim().length >= 2) restartSearch(0);
  });
}

watch(query, () => restartSearch(150));

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "p" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    inputRef.value?.focus();
  }
  if (event.key === "Escape") {
    inputRef.value?.blur();
    close();
  }
}

const onClickOutside = () => close();

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  close();
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
  background: var(--t-bg);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  border: 1px solid var(--t-border);
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  font-size: 14px;
  box-sizing: border-box;
  background: transparent;
  color: var(--t-fg);
}

.results-list {
  margin: 4px 0 0 0;
  padding: 0;
  list-style: none;
  background: var(--t-bg);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--t-border);
}

.result-item {
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--t-border);
  transition: background-color 0.1s;
  color: var(--t-fg);
}

.result-item:last-child {
  border-bottom: none;
}

.result-item.is-structural {
  cursor: default;
}

.result-item.selected,
.result-item:not(.is-structural):hover {
  background-color: var(--t-hover);
}

.is-child {
  border-left: 2px solid var(--t-border);
}
</style>
