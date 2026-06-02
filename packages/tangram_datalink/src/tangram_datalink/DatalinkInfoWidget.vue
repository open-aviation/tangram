<template>
  <div class="datalink-list">
    <div
      v-for="item in aircraftList"
      :key="item.id"
      class="list-item"
      :class="{ expanded: isExpanded(item.id) }"
    >
      <div class="header" @click="toggleExpand(item.id)">
        <div class="row main-row">
          <div class="left-group">
            <span class="flight-id">{{
              item.state.flight_id ||
              item.state.registration ||
              item.state.icao24 ||
              "Unknown"
            }}</span>
            <span v-if="item.state.registration" class="chip blue">{{
              item.state.registration
            }}</span>
            <span v-if="item.state.icao24" class="chip yellow">{{
              item.state.icao24
            }}</span>
          </div>
          <div class="right-group">
            <span v-if="item.state.altitude_ft !== undefined"
              >{{ item.state.altitude_ft }} ft</span
            >
            <span
              v-if="item.state.altitude_ft !== undefined && item.state.track != null"
              class="sep"
              >·</span
            >
            <span v-if="item.state.track != null"
              >{{ Math.round(item.state.track) }}°</span
            >
          </div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <div class="message-feed">
          <div
            v-for="msg in getMessages(item.id)"
            :key="msg.timestamp + (msg.raw_frame_hex || '')"
            class="message-item"
          >
            <div class="message-header">
              <span class="time">{{ getMessageHeader(msg) }}</span>
            </div>
            <div v-if="hasAppPayload(msg.app_data)" class="message-payload">
              <TreeView :data="msg.app_data" />
            </div>
            <div v-if="msg.text" class="raw-text">
              {{ msg.text }}
            </div>
          </div>
          <div v-if="getMessages(item.id).length === 0" class="no-data">
            No recent messages.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, reactive, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import { datalinkStore, type DatalinkMessage } from "./store";
import type { DatalinkAircraft } from "./index";
import TreeView from "./TreeView.vue";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const expandedIds = reactive(new Set<string>());

const aircraftList = computed(() => {
  const list = [];
  const entities =
    tangramApi.state.getEntitiesByType<DatalinkAircraft>("datalink_aircraft").value;
  for (const id of datalinkStore.selectedIds) {
    const entity = entities.get(id);
    if (entity) {
      list.push({ id, state: entity.state });
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
});

const isExpanded = (id: string) => {
  return aircraftList.value.length === 1 || expandedIds.has(id);
};

const toggleExpand = (id: string) => {
  if (aircraftList.value.length === 1) return;
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
};

const formatTime = (ts: number) => {
  return new Date(ts * 1000).toISOString().substring(11, 19) + "Z";
};

const hasAppPayload = (data: unknown) => {
  if (!data) return false;
  if (typeof data === "string") return false;
  if (Array.isArray(data) && data.length === 0) return false;
  if (typeof data === "object" && Object.keys(data).length === 0) return false;
  return true;
};

const getMessages = (id: string) => {
  return datalinkStore.selected.get(id)?.messages || [];
};

const getMessageHeader = (msg: DatalinkMessage) => {
  const summary = getMessageSummary(msg);
  return summary
    ? `${formatTime(msg.timestamp)} · ${summary}`
    : formatTime(msg.timestamp);
};

const withMessageMeta = (
  summary: string,
  msg: DatalinkMessage,
  includeLabel = true
) => {
  const extras = [];
  if (includeLabel && msg.label) extras.push(msg.label);
  if (msg.app_protocol) extras.push(msg.app_protocol);
  return extras.length > 0 ? `${summary} ${extras.join(" ")}` : summary;
};

// TODO its a bit confusing so maybe we can use pills instead
const getMessageSummary = (msg: DatalinkMessage) => {
  const p = msg.app_protocol?.toLowerCase();
  if (
    p === "atn_cpdlc" ||
    p === "cpdlc" ||
    msg.imi === "AT1" ||
    msg.imi === "CR1" ||
    msg.imi === "CC1" ||
    msg.imi === "DR1"
  )
    return withMessageMeta("CPDLC Message", msg);
  if (p === "ads_c" || msg.imi === "ADS") return withMessageMeta("ADS-C Report", msg);
  if (p === "x25") return withMessageMeta("X.25 Packet", msg);
  if (p === "xid") return withMessageMeta("XID Frame", msg);
  if (p === "miam") return withMessageMeta("MIAM Frame", msg);
  if (p === "ohma") return withMessageMeta("Boeing OHMA", msg);
  if (p === "sa") return withMessageMeta("Media Advisory", msg);
  if (p === "sq") return withMessageMeta("Squitter", msg);
  if (p === "afn") return withMessageMeta("AFN Logon", msg);
  if (p === "oc1") return withMessageMeta("Oceanic Clearance", msg);
  if (p === "oooi_qf" || p === "oooi_qq") return withMessageMeta("OOOI Report", msg);
  if (msg.label && msg.text)
    return withMessageMeta(`ACARS Label ${msg.label}`, msg, false);
  if (msg.label && !msg.text)
    return withMessageMeta(`ACARS Label ${msg.label} (Empty)`, msg, false);
  return withMessageMeta("Data Frame", msg);
};

watch(
  () => aircraftList.value.length,
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
  padding: 10px;
  cursor: default;
}
.message-feed {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.message-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid var(--t-accent1);
  padding-left: 8px;
}
.message-header {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.85em;
  flex-wrap: wrap;
}
.time {
  color: var(--t-muted);
  font-family: "Inconsolata", monospace;
}
.message-payload {
  margin-top: 4px;
  padding: 2px 0 2px 8px;
  border-left: 2px solid var(--t-border);
  overflow-x: auto;
}
.raw-text {
  font-family: "Inconsolata", monospace;
  font-size: 0.85em;
  color: var(--t-fg);
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 4px;
}
.no-data {
  color: var(--t-muted);
  font-style: italic;
  font-size: 0.9em;
  text-align: center;
}
</style>
