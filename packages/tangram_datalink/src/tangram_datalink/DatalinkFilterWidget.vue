<template>
  <div class="filter-widget">
    <!-- master toggle -->
    <div class="master-row">
      <label class="toggle-label">
        <input type="checkbox" :checked="filter.enabled" @change="toggle('enabled')" />
        <span>Filter entities by message type</span>
      </label>
    </div>

    <template v-if="filter.enabled">
      <div class="divider" />

      <!-- station toggles -->
      <div class="section-title">Stations</div>
      <div class="cat-list">
        <div v-for="sc in STATION_CATEGORIES" :key="sc.id" class="cat-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="filter.stations[sc.id]"
              @change="toggleStation(sc.id)"
            />
            <span class="cat-label">{{ sc.label }}</span>
            <span class="cat-desc">{{ sc.description }}</span>
          </label>
          <span class="cat-count" :class="{ zero: countStations(sc.id) === 0 }">
            {{ countStations(sc.id) }}
          </span>
        </div>
      </div>

      <div class="divider" />

      <!-- per-category toggles -->
      <div class="section-title">Aircraft — show if received at least one:</div>
      <div class="cat-list">
        <div v-for="cat in MESSAGE_CATEGORIES" :key="cat.id" class="cat-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="filter.categories[cat.id]"
              @change="toggleCategory(cat.id)"
            />
            <span class="cat-label">{{ cat.label }}</span>
            <span class="cat-desc">{{ cat.description }}</span>
          </label>
          <span class="cat-count" :class="{ zero: countFor(cat.id) === 0 }">
            {{ countFor(cat.id) }}
          </span>
        </div>
      </div>

      <div class="actions">
        <button class="action-btn" @click="selectAll">All</button>
        <button class="action-btn" @click="selectNone">None</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  datalinkStore,
  MESSAGE_CATEGORIES,
  STATION_CATEGORIES,
  type MessageCategoryId,
  type StationCategoryId
} from "./store";
import {
  ENTITY_TYPE,
  isAircraftEntity,
  isStationEntity,
  type DatalinkEntity
} from "./index";
import { inject } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";

// modelValue/emit are required by the settings panel framework but we manage state via the store
defineProps<{ modelValue?: unknown }>();
defineEmits(["update:modelValue"]);

const tangramApi = inject<TangramApi>("tangramApi");

const filter = computed(() => datalinkStore.filter);

const toggle = (key: "enabled") => {
  datalinkStore.filter[key] = !datalinkStore.filter[key];
  datalinkStore.version++;
};

const toggleStation = (id: StationCategoryId) => {
  datalinkStore.filter.stations[id] = !datalinkStore.filter.stations[id];
  datalinkStore.version++;
};

const toggleCategory = (id: MessageCategoryId) => {
  datalinkStore.filter.categories[id] = !datalinkStore.filter.categories[id];
  datalinkStore.version++;
};

const selectAll = () => {
  for (const cat of MESSAGE_CATEGORIES) datalinkStore.filter.categories[cat.id] = true;
  datalinkStore.version++;
};

const selectNone = () => {
  for (const cat of MESSAGE_CATEGORIES) datalinkStore.filter.categories[cat.id] = false;
  datalinkStore.version++;
};

/** count aircraft entities in a given category */
const countFor = (id: MessageCategoryId): number => {
  if (!tangramApi) return 0;
  const entities =
    tangramApi.state.getEntitiesByType<DatalinkEntity>(ENTITY_TYPE).value;
  let n = 0;
  for (const [eid, entity] of entities) {
    if (!isAircraftEntity(entity.state)) continue;
    const hist = datalinkStore.history.get(eid);
    if (hist?.categories.has(id)) n++;
  }
  return n;
};

/** count station entities for a given station category */
const countStations = (id: StationCategoryId): number => {
  if (!tangramApi) return 0;
  const entities =
    tangramApi.state.getEntitiesByType<DatalinkEntity>(ENTITY_TYPE).value;
  let n = 0;
  for (const [, entity] of entities) {
    if (!isStationEntity(entity.state)) continue;
    const linkType = entity.state.details.data.link_type;
    const cat = linkType === "VDL2" ? "vdl2" : "sq";
    if (cat === id) n++;
  }
  return n;
};
</script>

<style scoped>
.filter-widget {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0;
}
.master-row {
  display: flex;
  align-items: center;
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 600;
}
.divider {
  border-top: 1px solid var(--t-border);
  margin: 2px 0;
}
.section-title {
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--t-muted);
  margin-bottom: 2px;
}
.cat-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cat-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
}
.checkbox-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}
.cat-label {
  font-size: 0.9em;
  font-weight: 600;
  white-space: nowrap;
  min-width: 80px;
}
.cat-desc {
  font-size: 0.78em;
  color: var(--t-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-count {
  font-size: 0.78em;
  font-family: "Inconsolata", monospace;
  color: var(--t-muted);
  background: var(--t-surface);
  border: 1px solid var(--t-border);
  border-radius: 4px;
  padding: 0 5px;
  min-width: 22px;
  text-align: center;
  flex-shrink: 0;
}
.cat-count.zero {
  opacity: 0.4;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.action-btn {
  font-size: 0.8em;
  padding: 1px 8px;
  border: 1px solid var(--t-border);
  border-radius: 4px;
  background: var(--t-surface);
  color: var(--t-fg);
  cursor: pointer;
}
.action-btn:hover {
  background: var(--t-hover);
}
</style>
