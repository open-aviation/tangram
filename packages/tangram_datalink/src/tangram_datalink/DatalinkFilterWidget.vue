<template>
  <div class="filter-widget">
    <section class="filter-section">
      <div class="section-title">Stations</div>
      <div class="cat-list">
        <label class="cat-row group-row">
          <input
            type="checkbox"
            :checked="allStationsSelected"
            :indeterminate.prop="someStationsSelected && !allStationsSelected"
            @change="setAllStationsFromEvent"
          />
          <span class="cat-text">Show all stations</span>
        </label>

        <div v-for="sc in STATION_CATEGORIES" :key="sc.id" class="cat-row">
          <label class="checkbox-label cat-text">
            <input
              type="checkbox"
              :checked="filter.stations[sc.id]"
              @change="toggleStation(sc.id)"
            />
            <HoverLabel
              class="cat-label"
              :label="sc.label"
              :description="sc.description"
            />
          </label>
          <span class="cat-count" :class="{ zero: countStations(sc.id) === 0 }">
            {{ countStations(sc.id) }}
          </span>
        </div>
      </div>
    </section>

    <section class="filter-section">
      <div class="section-title">Filter aircraft by message type</div>
      <div class="cat-list">
        <label class="cat-row group-row">
          <input
            type="checkbox"
            :checked="allAircraftSelected"
            :indeterminate.prop="someAircraftSelected && !allAircraftSelected"
            @change="setAllAircraftFromEvent"
          />
          <span class="cat-text">Show all aircraft</span>
        </label>

        <div v-for="cat in MESSAGE_CATEGORIES" :key="cat.id" class="cat-row">
          <label class="checkbox-label cat-text">
            <input
              type="checkbox"
              :checked="filter.categories[cat.id]"
              @change="toggleCategory(cat.id)"
            />
            <HoverLabel
              class="cat-label"
              :label="cat.label"
              :description="cat.description"
            />
          </label>
          <span class="cat-count" :class="{ zero: countFor(cat.id) === 0 }">
            {{ countFor(cat.id) }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
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
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { HoverLabel } from "@open-aviation/tangram-core/components";

// modelValue/emit are required by the settings panel framework but we manage state via the store
defineProps<{ modelValue?: unknown }>();
defineEmits(["update:modelValue"]);

const tangramApi = inject<TangramApi>("tangramApi");

const filter = computed(() => datalinkStore.filter);

const allStationsSelected = computed(() =>
  STATION_CATEGORIES.every(sc => datalinkStore.filter.stations[sc.id])
);
const someStationsSelected = computed(() =>
  STATION_CATEGORIES.some(sc => datalinkStore.filter.stations[sc.id])
);

const allAircraftSelected = computed(() =>
  MESSAGE_CATEGORIES.every(cat => datalinkStore.filter.categories[cat.id])
);
const someAircraftSelected = computed(() =>
  MESSAGE_CATEGORIES.some(cat => datalinkStore.filter.categories[cat.id])
);

const toggleStation = (id: StationCategoryId) => {
  datalinkStore.filter.stations[id] = !datalinkStore.filter.stations[id];
  datalinkStore.version++;
};

const toggleCategory = (id: MessageCategoryId) => {
  datalinkStore.filter.categories[id] = !datalinkStore.filter.categories[id];
  datalinkStore.version++;
};

const setAllStations = (checked: boolean) => {
  for (const sc of STATION_CATEGORIES) datalinkStore.filter.stations[sc.id] = checked;
  datalinkStore.version++;
};

const setAllAircraft = (checked: boolean) => {
  for (const cat of MESSAGE_CATEGORIES)
    datalinkStore.filter.categories[cat.id] = checked;
  datalinkStore.version++;
};

const setAllStationsFromEvent = (event: Event) => {
  setAllStations((event.target as HTMLInputElement).checked);
};

const setAllAircraftFromEvent = (event: Event) => {
  setAllAircraft((event.target as HTMLInputElement).checked);
};

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
  gap: 10px;
  padding: 0;
  font-size: 0.8rem;
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--t-muted);
}

.cat-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cat-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.group-row {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  margin-bottom: 2px;
  color: var(--t-fg);
  cursor: pointer;
  padding: 1px 0 2px;
}

.checkbox-label {
  display: flex;
  align-items: start;
  gap: 7px;
  cursor: pointer;
  min-width: 0;
}
.checkbox-label input,
.group-row input {
  margin-top: 1px;
  flex-shrink: 0;
}

.cat-text {
  min-width: 0;
  line-height: 1.25;
}

.group-row .cat-text {
  padding-top: 1px;
}

.cat-label {
  display: inline;
  color: var(--t-fg);
  font-weight: 400;
}

.cat-count {
  font-size: 1em;
  font-family: "Inconsolata", monospace;
  color: var(--t-muted);
  line-height: 1.25;
  padding-top: 1px;
  min-width: 1.5rem;
  text-align: right;
}
.cat-count.zero {
  opacity: 0.45;
}
</style>
