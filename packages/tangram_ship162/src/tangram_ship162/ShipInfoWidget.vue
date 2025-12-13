<template>
  <div class="ship-list">
    <div
      v-for="item in shipList"
      :key="item.id"
      class="list-item"
      :class="{ expanded: isExpanded(item.id) }"
    >
      <div class="header" @click="toggleExpand(item.id)">
        <div class="row main-row">
          <div class="left-group">
            <span v-if="item.state.ship_name" class="ship-name">{{
              item.state.ship_name
            }}</span>
            <span v-else class="ship-name no-data">[no name]</span>
            <span v-if="item.state.ship_type" class="chip blue">{{
              item.state.ship_type
            }}</span>
            <span class="chip yellow">{{ item.state.mmsi }}</span>
          </div>
          <div class="right-group">
            <span v-if="item.state.speed !== undefined"
              >{{ item.state.speed.toFixed(1) }} kts</span
            >
            <span
              v-if="item.state.speed !== undefined && item.state.course !== undefined"
              class="sep"
              >·</span
            >
            <span v-if="item.state.course !== undefined"
              >{{ item.state.course.toFixed(0) }}°</span
            >
          </div>
        </div>
        <div class="row sub-row">
          <div class="left-group destination">
            {{ item.state.destination || "No destination" }}
          </div>
          <div class="right-group"></div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <div class="details-header">
          <span v-if="item.state.mmsi_info?.flag">
            {{ item.state.mmsi_info.flag }}
            {{ item.state.mmsi_info.country }}
          </span>
          <span v-if="item.state.status" class="status-chip">{{
            item.state.status
          }}</span>
        </div>

        <table class="details-table">
          <tr v-if="item.state.callsign">
            <td class="label">Callsign:</td>
            <td>{{ item.state.callsign }}</td>
          </tr>
          <tr v-if="item.state.imo">
            <td class="label">IMO:</td>
            <td>{{ item.state.imo }}</td>
          </tr>
          <tr v-if="getDimensions(item.state)">
            <td class="label">Dimensions:</td>
            <td>{{ getDimensions(item.state) }} m</td>
          </tr>
          <tr v-if="item.state.draught">
            <td class="label">Draught:</td>
            <td>{{ item.state.draught }} m</td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, reactive, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import type { Ship162Vessel } from ".";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const expandedIds = reactive(new Set<string>());

const shipList = computed(() => {
  const list = [];
  for (const [id, entity] of tangramApi.state.activeEntities.value) {
    if (entity.type === "ship162_ship") {
      list.push({ id, state: entity.state as Ship162Vessel });
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
});

const isExpanded = (id: string) => {
  return shipList.value.length === 1 || expandedIds.has(id);
};

const toggleExpand = (id: string) => {
  if (shipList.value.length === 1) return;
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
};

const getDimensions = (state: Ship162Vessel) => {
  const { to_bow, to_stern, to_port, to_starboard } = state;
  if (to_bow != null && to_stern != null && to_port != null && to_starboard != null) {
    const length = to_bow + to_stern;
    const width = to_port + to_starboard;
    if (length > 0 || width > 0) {
      return `${length} x ${width}`;
    }
  }
  return null;
};

watch(
  () => shipList.value.length,
  (newLen, oldLen) => {
    if (oldLen === 1 && newLen === 2) {
      expandedIds.clear();
    }
  }
);
</script>

<style scoped>
.ship-list {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 150px);
  overflow-y: auto;
}

.list-item {
  border-bottom: 1px solid #eee;
  cursor: pointer;
  background-color: white;
}

.list-item:hover .header {
  background-color: #f5f5f5;
}

.header {
  padding: 4px 8px;
}

.expanded .header {
  border-bottom: 1px solid #eee;
  background-color: #f0f7ff;
}

.details-body {
  padding: 10px;
  cursor: default;
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
  color: #333;
  white-space: nowrap;
}

.ship-name {
  font-size: 1.1em;
  font-weight: bold;
}

.no-data {
  color: #888;
  font-style: italic;
  font-size: 1em;
}

.destination {
  font-size: 0.9em;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.chip {
  border-radius: 5px;
  padding: 0px 5px;
  font-family: "Inconsolata", monospace;
  font-size: 1em;
  white-space: nowrap;
}

.chip.blue {
  background-color: #4c78a8;
  color: white;
  border: 1px solid #4c78a8;
}

.chip.yellow {
  background-color: #f2cf5b;
  color: black;
  border: 1px solid #e0c050;
}

.sub-row .right-group {
  color: #666;
}

.sep {
  color: #aaa;
  font-weight: normal;
}

/* details */
.details-header {
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-chip {
  background-color: #eee;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.9em;
  color: #555;
}

.details-table {
  border-collapse: collapse;
  width: 100%;
}

.details-table td {
  padding: 1px 0;
  border: none;
}

.details-table .label {
  text-align: right;
  font-weight: bold;
  padding-right: 10px;
  white-space: nowrap;
  width: 1%;
  color: #555;
}
</style>
