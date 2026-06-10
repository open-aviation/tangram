<template>
  <div class="datalink-list">
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
            <template v-if="item.state.kind === 'aircraft'">
              <span v-if="item.state.aircraft?.registration" class="chip blue">{{
                item.state.aircraft.registration
              }}</span>
              <span v-if="item.state.aircraft?.icao24" class="chip yellow">{{
                item.state.aircraft.icao24
              }}</span>
            </template>
            <template v-else>
              <span class="chip blue">SQ</span>
              <span
                v-if="item.state.station?.airport"
                class="chip yellow"
                :title="airportName(item.state.station.airport)"
                >{{ item.state.station.airport }}</span
              >
            </template>
          </div>
          <div class="right-group">
            <template v-if="item.state.kind === 'aircraft'">
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
            </template>
            <template v-else>
              <span v-if="item.state.station?.frequency_mhz"
                >{{ item.state.station.frequency_mhz.toFixed(3) }} MHz</span
              >
            </template>
          </div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <div class="message-feed">
          <div
            v-for="msg in getMessages(item.id)"
            :key="(msg.timestamp || 0) + (msg.raw_frame_hex || '')"
            class="message-item"
          >
            <div class="message-header">
              <span class="time">{{ getMessageHeader(msg) }}</span>
            </div>
            <div v-if="hasAppPayload(getPayloadData(msg))" class="message-payload">
              <TreeView :data="getPayloadData(msg)" />
            </div>
            <div v-if="msg.txt || msg.text" class="raw-text">
              {{ msg.txt || msg.text }}
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
import { ENTITY_TYPE, type DatalinkEntity } from "./index";
import { airportName } from "./airport";
import TreeView from "./TreeView.vue";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const expandedIds = reactive(new Set<string>());

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

const formatTime = (ts: number | undefined) => {
  if (!ts) return "N/A";
  return new Date(ts * 1000).toISOString().substring(11, 19) + "Z";
};

const hasAppPayload = (data: unknown) => {
  if (!data) return false;
  if (typeof data === "string") return false;
  if (Array.isArray(data) && data.length === 0) return false;
  if (typeof data === "object" && Object.keys(data).length === 0) return false;
  return true;
};

const getPayloadData = (msg: DatalinkMessage) => {
  const {
    event,
    timestamp,
    bearer,
    source,
    receiver,
    aircraft,
    kinematics,
    raw_frame_hex,
    ...rest
  } = msg;
  return rest;
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
  return extras.length > 0 ? `${summary} ${extras.join(" ")}` : summary;
};

// TODO its a bit confusing so maybe we can use pills instead
const getMessageSummary = (msg: DatalinkMessage) => {
  const pData = getPayloadData(msg) as any;
  let appVariant = null;
  let imi = null;

  if (pData.app && typeof pData.app === "object") {
    const keys = Object.keys(pData.app);
    if (keys.length === 1) appVariant = keys[0];
    else if (typeof pData.app === "string") appVariant = pData.app;
  }

  if (!appVariant) {
    if (pData.Arinc622) appVariant = "Arinc622";
    else if (pData.MIAM) appVariant = "MIAM";
    else if (pData.OHMA) appVariant = "OHMA";
    else if (pData.SA) appVariant = "SA";
    else if (pData.SQ || pData.Squitter) appVariant = "SQ";
    else if (pData.AOC80) appVariant = "AOC80";
  }

  if (appVariant === "Arinc622" && pData.app?.Arinc622) imi = pData.app.Arinc622.imi;
  else if (appVariant === "Arinc622" && pData.Arinc622) imi = pData.Arinc622.imi;
  else if (pData.imi) imi = pData.imi;

  if (
    appVariant === "Cpdlc" ||
    imi === "AT1" ||
    imi === "CR1" ||
    imi === "CC1" ||
    imi === "DR1"
  )
    return withMessageMeta("CPDLC Message", msg);
  if (appVariant === "Adsc" || imi === "ADS")
    return withMessageMeta("ADS-C Report", msg);

  if (pData.payload && typeof pData.payload === "object") {
    if ("X25" in pData.payload) return withMessageMeta("X.25 Packet", msg);
    if ("Xid" in pData.payload) return withMessageMeta("XID Frame", msg);
  }

  if (appVariant === "MIAM") return withMessageMeta("MIAM Frame", msg);
  if (appVariant === "OHMA") return withMessageMeta("Boeing OHMA", msg);
  if (appVariant === "SA") return withMessageMeta("Media Advisory", msg);
  if (appVariant === "SQ") return withMessageMeta("Squitter", msg);
  if (appVariant === "AFN") return withMessageMeta("AFN Logon", msg);
  if (appVariant === "OC1") return withMessageMeta("Oceanic Clearance", msg);
  if (appVariant === "QF" || appVariant === "QQ")
    return withMessageMeta("OOOI Report", msg);

  const text = msg.txt || msg.text;
  if (msg.label && text) return withMessageMeta(`ACARS Label ${msg.label}`, msg, false);
  if (msg.label && !text)
    return withMessageMeta(`ACARS Label ${msg.label} (Empty)`, msg, false);

  return withMessageMeta("Data Frame", msg);
};

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
