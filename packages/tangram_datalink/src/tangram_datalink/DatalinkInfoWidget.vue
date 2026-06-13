<template>
  <div
    ref="listRef"
    class="datalink-list"
    tabindex="0"
    @mouseenter="onListEnter"
    @mouseleave="onListLeave"
    @focusin="onListEnter"
    @focusout="onListFocusOut"
    @keydown.escape.stop.prevent="clearActiveCallout"
    @scroll="refreshActiveCallout"
  >
    <div
      v-for="item in entityList"
      :key="item.id"
      class="list-item"
      :class="{ expanded: isExpanded(item.id) }"
    >
      <div class="header" @click="toggleExpand(item.id)">
        <div class="row main-row">
          <div class="left-group">
            <span class="flight-id">{{ item.state.label }}</span>
            <template v-if="item.state.details.kind === 'aircraft'">
              <span v-if="item.state.details.data.registration" class="chip blue">{{
                item.state.details.data.registration
              }}</span>
              <span v-if="item.state.details.data.icao24" class="chip yellow">{{
                item.state.details.data.icao24
              }}</span>
            </template>
            <template v-else>
              <span class="chip blue">{{
                stationKindLabel(item.state.details.data.link_type)
              }}</span>
              <span
                v-if="
                  item.state.details.data.hexcode || item.state.details.data.airport
                "
                class="chip yellow"
                :title="
                  !item.state.details.data.hexcode
                    ? airportName(item.state.details.data.airport)
                    : undefined
                "
                >{{
                  item.state.details.data.hexcode || item.state.details.data.airport
                }}</span
              >
            </template>
          </div>
          <div class="right-group">
            <template v-if="item.state.details.kind === 'aircraft'">
              <span v-if="item.state.altitude_ft != null"
                >{{ item.state.altitude_ft }} ft</span
              >
              <span
                v-if="item.state.altitude_ft != null && item.state.track != null"
                class="sep"
                >·</span
              >
              <span v-if="item.state.track != null"
                >{{ Math.round(item.state.track) }}°</span
              >
            </template>
            <template v-else>
              <span
                v-if="item.state.details.data.airport"
                :title="airportName(item.state.details.data.airport)"
                >{{ item.state.details.data.airport }}</span
              >
              <span
                v-if="
                  item.state.details.data.airport &&
                  item.state.details.data.frequency_mhz
                "
                class="sep"
                >·</span
              >
              <span
                v-if="item.state.details.data.frequency_mhz"
                :title="
                  item.state.details.data.supported_frequencies_mhz?.length
                    ? `Supported: ${formatFrequencies(item.state.details.data.supported_frequencies_mhz ?? [])}`
                    : undefined
                "
                >{{ item.state.details.data.frequency_mhz?.toFixed(3) }} MHz</span
              >
            </template>
          </div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <div v-if="feedRowsByEntity(item.id).length > 0" class="message-feed">
          <DatalinkFeedRow
            v-for="row in feedRowsByEntity(item.id)"
            :key="row.key"
            :row="row"
            @register="setFeedRowRef"
            @preview="previewFeedRow"
            @clear-preview="clearFeedPreview"
            @toggle="togglePinnedFeedRow"
          />
        </div>
      </div>
    </div>

    <Teleport to="body">
      <DatalinkFeedCallout
        v-if="activeFeedRow"
        :row="activeFeedRow"
        :active-key="activeFeedKey"
        :tree-key="treeFeedKey"
        :pinned="Boolean(pinnedFeedKey)"
        :hitbox-style="calloutHitboxStyle"
        :bridge-style="calloutBridgeStyle"
        :panel-style="calloutPanelStyle"
        @keep-open="keepCalloutOpen"
        @schedule-close="scheduleHoverClear"
        @clear="clearActiveCallout"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  inject,
  markRaw,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  toRaw,
  watch,
  type Component,
  type CSSProperties
} from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { useVimList } from "@open-aviation/tangram-core/keyboard";
import {
  MESSAGE_CATEGORIES,
  classifyCategory,
  datalinkStore,
  type DatalinkMessage,
  type MessageCategoryId
} from "./store";
import { ENTITY_TYPE, type DatalinkEntity } from "./index";
import { airportName } from "./airport";
import DatalinkFeedCallout from "./DatalinkFeedCallout.vue";
import DatalinkFeedRow, { type DatalinkFeedRowModel } from "./DatalinkFeedRow.vue";
import AdscSummary from "./AdscSummary.vue";
import CpdlcSummary from "./CpdlcSummary.vue";
import DefaultMessageSummary from "./DefaultMessageSummary.vue";
import { messageKeyParts, messageText } from "./summary_helpers";
import { createImperativeRowClassSync } from "./useImperativeRowClasses";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const expandedIds = reactive(new Set<string>());
const listRef = ref<HTMLElement | null>(null);
const isFeedNavigationActive = ref(false);
const hoveredFeedKey = ref<string | null>(null);
const pinnedFeedKey = ref<string | null>(null);
const treeFeedKey = ref<string | null>(null);
const calloutHitboxStyle = ref<CSSProperties>({});
const calloutBridgeStyle = ref<CSSProperties>({});
const calloutPanelStyle = ref<CSSProperties>({});
const feedRowRefs = new Map<string, HTMLElement>();
let treeFrame: number | null = null;
let hoverClearTimer: number | null = null;
const rowClasses = createImperativeRowClassSync(feedRowRefs);

const messageCategoryLabel = new Map<MessageCategoryId, string>(
  MESSAGE_CATEGORIES.map(category => [category.id, category.label])
);

type FeedRow = DatalinkFeedRowModel;

const EMPTY_FEED_ROWS: FeedRow[] = [];

const entityList = computed(() => {
  const list = [];
  const entities =
    tangramApi.state.getEntitiesByType<DatalinkEntity>(ENTITY_TYPE).value;
  for (const id of datalinkStore.selectedIds) {
    const entity = entities.get(id);
    if (entity) {
      list.push({ id, state: entity.state });
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
});

const isExpanded = (id: string) => {
  return entityList.value.length === 1 || expandedIds.has(id);
};

const toggleExpand = (id: string) => {
  if (entityList.value.length === 1) return;
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
};

const stationKindLabel = (linkType: string | null | undefined) => {
  return linkType === "VDL2" ? "VDL2" : `SQ: ${linkType || "?"}`;
};

const formatFrequencies = (frequencies: number[]) => {
  return frequencies.map(freq => `${freq.toFixed(3)} MHz`).join(", ");
};

const getMessages = (id: string) => {
  return datalinkStore.selected.get(id)?.messages || [];
};

const feedMessageKey = (entityId: string, msg: DatalinkMessage) =>
  `${entityId}:${messageKeyParts(msg)}`;

const summaryComponentByCategory: Partial<Record<MessageCategoryId, Component>> = {
  adsc: markRaw(AdscSummary),
  cpdlc: markRaw(CpdlcSummary)
};

const defaultSummaryComponent = markRaw(DefaultMessageSummary);

const summaryComponentFor = (category: MessageCategoryId) =>
  category === "text"
    ? undefined
    : (summaryComponentByCategory[category] ?? defaultSummaryComponent);

const feedRows = computed<FeedRow[]>(() => {
  const rows: FeedRow[] = [];
  const keyCounts = new Map<string, number>();
  for (const item of entityList.value) {
    for (const msg of getMessages(item.id)) {
      const rawMsg = markRaw(toRaw(msg) as DatalinkMessage);
      const category = classifyCategory(rawMsg);
      const baseKey = feedMessageKey(item.id, rawMsg);
      const keyCount = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, keyCount + 1);
      rows.push({
        entityId: item.id,
        key: keyCount === 0 ? baseKey : `${baseKey}:${keyCount}`,
        index: rows.length,
        msg: rawMsg,
        category,
        categoryLabel: messageCategoryLabel.get(category) ?? category,
        summaryComponent: summaryComponentFor(category),
        text: messageText(rawMsg)
      });
    }
  }
  return rows;
});

const feedRowsByEntityMap = computed(() => {
  const rowsByEntity = new Map<string, FeedRow[]>();
  for (const row of feedRows.value) {
    const rows = rowsByEntity.get(row.entityId);
    if (rows) rows.push(row);
    else rowsByEntity.set(row.entityId, [row]);
  }
  return rowsByEntity;
});

const feedRowsByKey = computed(() => {
  const rowsByKey = new Map<string, FeedRow>();
  for (const row of feedRows.value) rowsByKey.set(row.key, row);
  return rowsByKey;
});

const feedRowsByEntity = (entityId: string) =>
  feedRowsByEntityMap.value.get(entityId) ?? EMPTY_FEED_ROWS;

const updateCalloutAnchor = (key: string | null) => {
  if (key == null) return;
  const row = feedRowRefs.get(key);
  if (!row) return;

  const rect = row.getBoundingClientRect();
  const gap = 10;
  const panelLeft = Math.min(rect.right + gap, window.innerWidth - 320);
  const panelTop = Math.max(8, Math.min(rect.top, window.innerHeight - 180));
  const panelWidth = Math.max(280, Math.min(520, window.innerWidth - panelLeft - 8));
  const hitboxLeft = Math.min(rect.right, panelLeft);
  const bridgeWidth = Math.max(0, panelLeft - hitboxLeft);
  const maxHeight = Math.max(180, window.innerHeight - panelTop - 8);
  calloutHitboxStyle.value = {
    left: `${hitboxLeft}px`,
    top: `${panelTop}px`,
    width: `${bridgeWidth + panelWidth}px`,
    maxHeight: `${maxHeight}px`
  };
  calloutBridgeStyle.value = { width: `${bridgeWidth}px` };
  calloutPanelStyle.value = {
    width: `${panelWidth}px`,
    maxHeight: `${maxHeight}px`
  };
};

const refreshActiveCallout = () => {
  updateCalloutAnchor(activeFeedKey.value);
};

const cancelTreeFrame = () => {
  if (treeFrame == null) return;
  window.cancelAnimationFrame(treeFrame);
  treeFrame = null;
};

const cancelHoverClear = () => {
  if (hoverClearTimer == null) return;
  window.clearTimeout(hoverClearTimer);
  hoverClearTimer = null;
};

const scheduleHoverClear = () => {
  if (pinnedFeedKey.value) return;
  cancelHoverClear();
  hoverClearTimer = window.setTimeout(() => {
    hoveredFeedKey.value = null;
    hoverClearTimer = null;
  }, 140);
};

const keepCalloutOpen = () => {
  cancelHoverClear();
};

const scheduleTreeRender = (key: string | null) => {
  cancelTreeFrame();
  treeFeedKey.value = null;
  if (key == null) return;

  treeFrame = window.requestAnimationFrame(() => {
    treeFrame = null;
    if (activeFeedKey.value === key) treeFeedKey.value = key;
  });
};

const setFeedRowRef = (key: string, element: Element | null) => {
  if (element instanceof HTMLElement) {
    feedRowRefs.set(key, element);
    if (activeFeedKey.value === key) updateCalloutAnchor(key);
  } else {
    feedRowRefs.delete(key);
  }
};

const previewFeedRow = (key: string) => {
  cancelHoverClear();
  if (pinnedFeedKey.value && pinnedFeedKey.value !== key) return;
  hoveredFeedKey.value = key;
  updateCalloutAnchor(key);
};

const clearFeedPreview = (key: string) => {
  if (pinnedFeedKey.value === key) return;
  if (hoveredFeedKey.value === key) scheduleHoverClear();
};

const clearActiveCallout = () => {
  cancelHoverClear();
  hoveredFeedKey.value = null;
  pinnedFeedKey.value = null;
  setFocus(null);
};

const togglePinnedFeedRow = (key: string) => {
  if (pinnedFeedKey.value === key) {
    clearActiveCallout();
    return;
  }

  pinnedFeedKey.value = key;
  hoveredFeedKey.value = null;
  updateCalloutAnchor(key);
  const index = feedRows.value.findIndex(row => row.key === key);
  if (index >= 0) setFocus(index);
};

const onListEnter = () => {
  isFeedNavigationActive.value = true;
  listRef.value?.focus({ preventScroll: true });
};

const onListLeave = () => {
  isFeedNavigationActive.value = false;
  if (pinnedFeedKey.value == null) scheduleHoverClear();
  setFocus(null);
};

const onListFocusOut = (event: FocusEvent) => {
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && listRef.value?.contains(nextTarget)) return;
  onListLeave();
};

const { focusedIndex, setFocus } = useVimList(feedRows, {
  isActive: isFeedNavigationActive,
  target: listRef,
  actionBindings: {
    space: "select",
    enter: "select"
  },
  onAction: (action, start) => {
    if (action !== "select") return;
    const row = feedRows.value[start];
    if (row) togglePinnedFeedRow(row.key);
  }
});

const focusedFeedKey = computed(() => {
  const index = focusedIndex.value;
  return index == null ? null : (feedRows.value[index]?.key ?? null);
});

const activeFeedKey = computed(
  () => pinnedFeedKey.value ?? hoveredFeedKey.value ?? focusedFeedKey.value
);

const activeFeedRow = computed(() =>
  activeFeedKey.value == null
    ? null
    : (feedRowsByKey.value.get(activeFeedKey.value) ?? null)
);

watch(focusedFeedKey, async key => {
  rowClasses.setFocused(key);
  if (key == null) return;

  await nextTick();
  const row = feedRowRefs.get(key);
  row?.scrollIntoView({ block: "nearest" });
  updateCalloutAnchor(key);
});

watch(activeFeedKey, key => {
  rowClasses.setActive(key);
  rowClasses.setPinned(pinnedFeedKey.value);
  updateCalloutAnchor(key);
  scheduleTreeRender(key);
});

watch(pinnedFeedKey, key => {
  rowClasses.setPinned(key);
});

watch(feedRowsByKey, rowsByKey => {
  if (hoveredFeedKey.value && !rowsByKey.has(hoveredFeedKey.value))
    hoveredFeedKey.value = null;
  if (pinnedFeedKey.value && !rowsByKey.has(pinnedFeedKey.value))
    pinnedFeedKey.value = null;
  rowClasses.sync(activeFeedKey.value, focusedFeedKey.value, pinnedFeedKey.value);
});

onMounted(() => {
  window.addEventListener("resize", refreshActiveCallout);
});

onUnmounted(() => {
  cancelTreeFrame();
  cancelHoverClear();
  window.removeEventListener("resize", refreshActiveCallout);
});

watch(
  () => entityList.value.length,
  (newLen, oldLen) => {
    if (oldLen === 1 && newLen === 2) {
      expandedIds.clear();
    }
  }
);
</script>

<style scoped>
.datalink-list {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 150px);
  overflow-y: auto;
}
.list-item {
  border-bottom: 1px solid var(--t-border);
  cursor: pointer;
  background-color: var(--t-bg);
}
.list-item:hover .header {
  background-color: var(--t-hover);
}
.header {
  padding: 4px 8px;
}
.expanded .header {
  border-bottom: 1px solid var(--t-border);
  background-color: var(--t-surface);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  line-height: 1.4;
}
.main-row {
  margin-bottom: 2px;
}
.left-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.right-group {
  text-align: right;
  display: flex;
  gap: 4px;
  font-family: "B612", monospace;
  font-size: 0.9em;
  color: var(--t-fg);
}
.sep {
  color: var(--t-muted);
}
.flight-id {
  font-size: 1.1em;
  font-weight: bold;
}
.chip {
  border-radius: 5px;
  padding: 0px 5px;
  font-family: "Inconsolata", monospace;
  font-size: 1em;
}
.chip.small {
  font-size: 0.8em;
  padding: 0px 4px;
}
.chip.blue {
  background-color: var(--t-accent1);
  color: var(--t-accent1-fg);
  border: 1px solid var(--t-accent1);
}
.chip.yellow {
  background-color: var(--t-accent2);
  color: var(--t-accent2-fg);
  border: 1px solid var(--t-accent2);
}
.details-body {
  padding: 4px 5px 5px;
  cursor: default;
}

.message-feed {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
</style>
