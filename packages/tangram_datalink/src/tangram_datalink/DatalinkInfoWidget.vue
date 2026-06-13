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
        <!-- ADS-C subsection -->
        <template
          v-if="
            item.state.details.kind === 'aircraft' && adscHistory(item.id).length > 0
          "
        >
          <div class="section-header">ADS-C</div>
          <div class="adsc-list">
            <div
              v-for="(report, idx) in adscHistory(item.id)"
              :key="idx"
              class="adsc-report"
              :class="{ uplink: report.is_uplink }"
            >
              <div class="dir-bubble" :class="report.is_uplink ? 'uplink' : 'downlink'">
                {{ report.is_uplink ? "uplink" : "downlink" }}
              </div>
              <div class="adsc-time">
                {{ formatTime(report.timestamp) }}
                <span v-if="report.registration" class="adsc-reg">{{
                  report.registration
                }}</span>
                <span v-if="report.atsu_address" class="atsu">{{
                  report.atsu_address
                }}</span>
              </div>

              <!-- Uplink: contract request -->
              <template v-if="report.is_uplink && report.contract">
                <span class="adsc-field contract-type">{{
                  report.contract.kind === "periodic"
                    ? "Request periodic reports"
                    : report.contract.kind === "event"
                      ? "Request event reports"
                      : report.contract.kind === "emergency"
                        ? "Request emergency reports"
                        : report.contract.kind === "cancel_all"
                          ? "Cancel all contracts"
                          : report.contract.kind === "cancel"
                            ? `Cancel contract #${report.contract.number}`
                            : report.contract.kind
                }}</span>
                <span
                  v-if="
                    report.contract.number != null &&
                    !['cancel', 'cancel_all'].includes(report.contract.kind)
                  "
                  class="adsc-field muted"
                  >contract #{{ report.contract.number }}</span
                >
                <template v-for="(g, gi) in report.contract.groups" :key="gi">
                  <span class="adsc-field contract-group">
                    {{ formatContractGroup(g) }}
                  </span>
                </template>
              </template>

              <!-- Downlink: position report -->
              <template v-else>
                <div class="adsc-fields">
                  <span v-if="report.flight_id" class="adsc-field muted"
                    >flight {{ report.flight_id }}</span
                  >
                  <span v-if="report.position" class="adsc-field">
                    {{ report.position.latitude.toFixed(4) }}°
                    {{ report.position.longitude.toFixed(4) }}°
                    <span v-if="report.altitude_ft">
                      · FL{{ Math.round(report.altitude_ft / 100) }}</span
                    >
                  </span>
                  <span
                    v-if="report.track != null || report.ground_speed_kt != null"
                    class="adsc-field"
                  >
                    <span v-if="report.track != null"
                      >{{ Math.round(report.track) }}°</span
                    >
                    <span v-if="report.track != null && report.ground_speed_kt != null">
                      ·
                    </span>
                    <span v-if="report.ground_speed_kt != null"
                      >{{ Math.round(report.ground_speed_kt) }} kt</span
                    >
                    <span
                      v-if="
                        report.vertical_speed_fpm != null &&
                        report.vertical_speed_fpm !== 0
                      "
                    >
                      {{ report.vertical_speed_fpm > 0 ? " ↑" : " ↓"
                      }}{{ Math.abs(report.vertical_speed_fpm) }} fpm
                    </span>
                  </span>
                  <span v-if="report.next" class="adsc-field next-wpt">
                    next {{ report.next.latitude.toFixed(3) }}°
                    {{ report.next.longitude.toFixed(3) }}°
                    <span v-if="report.next.altitude_ft">
                      FL{{ Math.round(report.next.altitude_ft / 100) }}</span
                    >
                    <span v-if="report.next.eta_secs != null">
                      in {{ Math.round(report.next.eta_secs / 60) }} min</span
                    >
                  </span>
                  <template v-if="report.intermediate_projections?.length">
                    <span
                      v-for="(ip, i) in report.intermediate_projections"
                      :key="i"
                      class="adsc-field next-wpt"
                    >
                      intmd {{ Math.round(ip.distance_nm) }} nm /
                      {{ Math.round(ip.track_degrees) }}°
                      <span v-if="ip.altitude_ft">
                        FL{{ Math.round(ip.altitude_ft / 100) }}</span
                      >
                      <span v-if="ip.eta_secs != null">
                        in {{ Math.round(ip.eta_secs / 60) }} min</span
                      >
                    </span>
                  </template>
                  <template v-if="report.fixed_projections?.length">
                    <span
                      v-for="(fp, i) in report.fixed_projections"
                      :key="i"
                      class="adsc-field next-wpt"
                    >
                      fixed {{ fp.latitude.toFixed(3) }}° {{ fp.longitude.toFixed(3) }}°
                      <span v-if="fp.altitude_ft">
                        FL{{ Math.round(fp.altitude_ft / 100) }}</span
                      >
                      <span v-if="fp.eta_secs != null">
                        in {{ Math.round(fp.eta_secs / 60) }} min</span
                      >
                    </span>
                  </template>
                  <span v-if="report.wind_speed_kt != null" class="adsc-field meteo">
                    <span v-if="report.wind_direction_deg != null"
                      >{{ Math.round(report.wind_direction_deg) }}° </span
                    >{{ Math.round(report.wind_speed_kt) }} kt
                    <span v-if="report.temperature_c != null">
                      · {{ report.temperature_c }}°C</span
                    >
                  </span>
                  <span
                    v-if="report.raw_tags.some(t => !knownDownlinkTags.has(t))"
                    class="adsc-field muted"
                  >
                    {{
                      report.raw_tags.filter(t => !knownDownlinkTags.has(t)).join(", ")
                    }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- CPDLC subsection -->
        <template
          v-if="
            item.state.details.kind === 'aircraft' && cpdlcHistory(item.id).length > 0
          "
        >
          <div class="section-header">CPDLC</div>
          <div class="cpdlc-list">
            <div
              v-for="(msg, idx) in cpdlcHistory(item.id)"
              :key="idx"
              class="cpdlc-msg"
            >
              <div
                class="dir-bubble"
                :class="msg.direction === 'downlink' ? 'downlink' : 'uplink'"
              >
                {{ msg.direction === "downlink" ? "downlink" : "uplink" }}
              </div>
              <div class="message-header">
                <span class="time">{{ formatTime(msg.timestamp) }}</span>
                <span class="imi-badge">{{ msg.imi }}</span>
                <span v-if="msg.atsu_address" class="atsu">{{ msg.atsu_address }}</span>
              </div>
              <div class="cpdlc-elements">
                <div
                  v-for="(el, ei) in msg.elements"
                  :key="ei"
                  class="cpdlc-element"
                  :class="{ additional: el.is_additional }"
                >
                  <span class="el-name">#{{ el.id }}</span>
                  <TreeView v-if="el.body != null" :data="el.body" class="cpdlc-body" />
                  <span v-else class="el-sentence muted">no body</span>
                </div>
                <div
                  v-if="!msg.elements.length && msg.control_type"
                  class="cpdlc-element"
                >
                  <span class="el-sentence control">{{ msg.control_type }}</span>
                </div>
                <div v-if="msg.header?.msg_ref != null" class="cpdlc-ref">
                  └ ref #{{ msg.header.msg_ref }}
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- General message feed (collapsible, collapsed by default) -->
        <div class="section-header feed-header" @click.stop="toggleFeed(item.id)">
          <span>Feed</span>
          <span class="feed-count">({{ getMessages(item.id).length }})</span>
          <span class="feed-chevron">{{ feedExpanded.has(item.id) ? "▾" : "▸" }}</span>
        </div>
        <div v-if="feedExpanded.has(item.id)" class="message-feed">
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
            <div v-if="messageText(msg)" class="raw-text">
              {{ messageText(msg) }}
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
import {
  datalinkStore,
  messageApp,
  messageData,
  messageLabel,
  type DatalinkMessage,
  type AdscContractGroupInfo,
  type JsonObject
} from "./store";
import { ENTITY_TYPE, type DatalinkEntity } from "./index";
import { airportName } from "./airport";
import TreeView from "./TreeView.vue";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const expandedIds = reactive(new Set<string>());
const feedExpanded = reactive(new Set<string>());

// Tags that have structured rendering; all others shown as a muted fallback line
const knownDownlinkTags = new Set([
  "BasicReport",
  "EmergencyBasicReport",
  "WaypointChangeEvent",
  "LateralDeviationChangeEvent",
  "VerticalRateChangeEvent",
  "AltitudeRangeEvent",
  "FlightId",
  "PredictedRoute",
  "EarthReferenceData",
  "AirReferenceData",
  "IntermediateProjection",
  "FixedProjection",
  "MeteoData",
  "Acknowledgement",
  "NegativeAcknowledgement",
  "NoncomplianceNotification"
]);

const contractGroupLabel: Record<string, string> = {
  report_interval: "Report interval",
  flight_id: "Flight ID",
  predicted_route: "Predicted route",
  earth_reference_data: "Earth ref data",
  air_reference_data: "Air ref data",
  meteo_data: "Meteo data",
  airframe_id: "Airframe ID",
  lateral_deviation_change: "Lateral deviation",
  vertical_speed_change: "Vertical speed change",
  altitude_range: "Altitude range",
  report_waypoint_changes: "Waypoint changes",
  aircraft_intent_data: "Aircraft intent"
};

const formatContractGroup = (g: AdscContractGroupInfo): string => {
  const label = contractGroupLabel[g.kind] ?? g.kind;
  if (g.interval_secs != null) return `${label}: every ${g.interval_secs}s`;
  if (g.modulus != null) return `${label} (mod ${g.modulus})`;
  if (g.threshold_nm != null) return `${label}: ±${g.threshold_nm} nm`;
  if (g.threshold_fpm != null) return `${label}: >${g.threshold_fpm} fpm`;
  if (g.ceiling_ft != null) return `${label}: ${g.floor_ft}–${g.ceiling_ft} ft`;
  if (g.projection_time_mins != null) return `${label}: ${g.projection_time_mins} min`;
  return label;
};

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

const toggleFeed = (id: string) => {
  if (feedExpanded.has(id)) feedExpanded.delete(id);
  else feedExpanded.add(id);
};

const adscHistory = (id: string) => datalinkStore.history.get(id)?.adsc ?? [];
const cpdlcHistory = (id: string) => datalinkStore.history.get(id)?.cpdlc ?? [];

const formatTime = (ts: number | null | undefined) => {
  if (!ts) return "N/A";
  return new Date(ts * 1000).toISOString().substring(11, 19) + "Z";
};

const stationKindLabel = (linkType: string | null | undefined) => {
  return linkType === "VDL2" ? "VDL2" : `SQ: ${linkType || "?"}`;
};

const formatFrequencies = (frequencies: number[]) => {
  return frequencies.map(freq => `${freq.toFixed(3)} MHz`).join(", ");
};

const hasAppPayload = (data: unknown) => {
  if (!data) return false;
  if (typeof data === "string") return false;
  if (Array.isArray(data) && data.length === 0) return false;
  if (typeof data === "object" && Object.keys(data).length === 0) return false;
  return true;
};

const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const variantName = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  return keys.length === 1 ? keys[0] : null;
};

const variantPayload = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const stringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

const getPayloadData = (msg: DatalinkMessage) => msg.message;

const messageText = (msg: DatalinkMessage): string | undefined => {
  const data = messageData(msg);
  const payload = isRecord(data?.payload) ? data.payload : null;
  return (
    stringField(data, "text") ??
    stringField(data, "txt") ??
    stringField(payload, "text") ??
    stringField(payload, "txt")
  );
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

const withMessageMeta = (parts: string[], msg: DatalinkMessage) => {
  const label = messageLabel(msg);
  if (label) parts.push(label);
  return parts.join(" ");
};

const getMessageSummary = (msg: DatalinkMessage) => {
  const app = messageApp(msg);
  const appKind = variantName(app);
  const arinc = variantPayload(app, "Arinc622");
  const imi = stringField(arinc, "imi");
  const payloadKind = stringField(isRecord(arinc) ? arinc.payload : undefined, "kind");

  const parts = [msg.message.kind];
  if (appKind) parts.push(appKind);
  if (imi) parts.push(imi);
  if (payloadKind) parts.push(payloadKind);

  const data = messageData(msg);
  const avlcPayload = isRecord(data?.payload) ? data.payload : null;
  if (msg.message.kind === "avlc" && avlcPayload?.X25) parts.push("X25");
  if (msg.message.kind === "avlc" && avlcPayload?.Xid) parts.push("XID");

  return withMessageMeta(parts, msg);
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
  padding: 6px 8px 10px;
  cursor: default;
}

/* ── Section headers ── */
.section-header {
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--t-muted);
  border-top: 1px solid var(--t-border);
  padding: 6px 0 3px;
  margin-bottom: 4px;
}

/* ── ADS-C ── */
.adsc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}
.adsc-report {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid var(--t-accent2);
  padding-left: 8px;
  padding-right: 36px;
}
.adsc-report.uplink {
  border-left-color: var(--t-muted);
  opacity: 0.85;
}
.dir-bubble {
  position: absolute;
  top: 2px;
  right: 0;
  font-family: "Inconsolata", monospace;
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.5;
  pointer-events: none;
}
.dir-bubble.downlink {
  background: color-mix(in oklch, var(--t-accent1) 18%, transparent);
  color: color-mix(in oklch, var(--t-accent1) 80%, var(--t-fg));
  border: 1px solid color-mix(in oklch, var(--t-accent1) 40%, transparent);
}
.dir-bubble.uplink {
  background: color-mix(in oklch, var(--t-muted) 12%, transparent);
  color: var(--t-muted);
  border: 1px solid color-mix(in oklch, var(--t-muted) 30%, transparent);
}
.adsc-time {
  font-family: "Inconsolata", monospace;
  font-size: 0.8em;
  color: var(--t-muted);
  display: flex;
  align-items: center;
  gap: 5px;
}
.adsc-reg {
  font-family: "Inconsolata", monospace;
  color: var(--t-muted);
}
.adsc-fields {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.adsc-field {
  font-family: "B612", monospace;
  color: var(--t-fg);
}
.adsc-field.next-wpt {
  color: color-mix(in oklch, var(--t-accent1), var(--t-fg) 30%);
}
.adsc-field.meteo {
  color: var(--t-muted);
}
.adsc-field.muted {
  color: var(--t-muted);
  font-size: 0.8em;
}
.adsc-field.contract-type {
  font-weight: 600;
  color: var(--t-fg);
}
.adsc-field.contract-group {
  color: var(--t-muted);
  font-size: 0.82em;
  padding-left: 8px;
}

/* ── CPDLC ── */
.cpdlc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}
.cpdlc-msg {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid var(--t-accent1);
  padding-left: 8px;
  padding-right: 36px;
}
.cpdlc-msg .message-header {
  font-family: "Inconsolata", monospace;
  color: var(--t-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
}
.cpdlc-msg .time {
  font-family: "Inconsolata", monospace;
  font-size: 1em;
  color: var(--t-muted);
}
.imi-badge {
  font-family: "Inconsolata", monospace;
  font-size: 1em;
  color: var(--t-muted);
  border: 1px solid var(--t-border);
  border-radius: 3px;
  padding: 0 3px;
}
.atsu {
  font-family: "Inconsolata", monospace;
  font-size: 1em;
  color: var(--t-muted);
}
.cpdlc-elements {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cpdlc-element {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: "B612", monospace;
  color: var(--t-fg);
}
.cpdlc-element.additional {
  opacity: 0.8;
}
.el-name {
  font-family: "Inconsolata", monospace;
  font-size: 0.8em;
  color: var(--t-muted);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 36px;
}
.el-sentence {
  color: var(--t-fg);
}
.el-sentence.control {
  font-style: italic;
  color: var(--t-muted);
}
.cpdlc-ref {
  font-family: "Inconsolata", monospace;
  font-size: 0.75em;
  color: var(--t-muted);
  padding-left: 4px;
}

/* ── General feed ── */
.feed-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 5px;
}
.feed-header:hover {
  color: var(--t-fg);
}
.feed-count {
  font-size: 0.85em;
  color: var(--t-muted);
}
.feed-chevron {
  font-size: 0.7em;
  color: var(--t-muted);
  margin-left: auto;
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
  border-left: 2px solid var(--t-border);
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
