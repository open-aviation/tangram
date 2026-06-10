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
              <span class="chip blue">{{
                stationKindLabel(item.state.station?.link_type)
              }}</span>
              <span
                v-if="item.state.station?.hexcode || item.state.station?.airport"
                class="chip yellow"
                :title="
                  !item.state.station?.hexcode
                    ? airportName(item.state.station?.airport)
                    : undefined
                "
                >{{ item.state.station.hexcode || item.state.station.airport }}</span
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
              <span
                v-if="item.state.station?.airport"
                :title="airportName(item.state.station.airport)"
                >{{ item.state.station.airport }}</span
              >
              <span
                v-if="item.state.station?.airport && item.state.station?.frequency_mhz"
                class="sep"
                >·</span
              >
              <span
                v-if="item.state.station?.frequency_mhz"
                :title="
                  item.state.station?.supported_frequencies_mhz?.length
                    ? `Supported: ${formatFrequencies(item.state.station.supported_frequencies_mhz)}`
                    : undefined
                "
                >{{ item.state.station.frequency_mhz.toFixed(3) }} MHz</span
              >
            </template>
          </div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <!-- ADS-C subsection -->
        <template
          v-if="item.state.kind === 'aircraft' && adscHistory(item.id).length > 0"
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
                {{ report.is_uplink ? 'uplink' : 'downlink' }}
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
          v-if="item.state.kind === 'aircraft' && cpdlcHistory(item.id).length > 0"
        >
          <div class="section-header">CPDLC</div>
          <div class="cpdlc-list">
            <div
              v-for="(msg, idx) in cpdlcHistory(item.id)"
              :key="idx"
              class="cpdlc-msg"
            >
              <div class="dir-bubble" :class="msg.direction === 'downlink' ? 'downlink' : 'uplink'">
                {{ msg.direction === 'downlink' ? 'downlink' : 'uplink' }}
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
                  <span class="el-name">{{ formatElName(el.name) }}</span>
                  <span class="el-sentence">{{ fillTemplate(el) }}</span>
                </div>
                <div
                  v-if="!msg.elements.length && msg.control_type"
                  class="cpdlc-element"
                >
                  <span class="el-sentence control">{{
                    formatControlType(msg.control_type)
                  }}</span>
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
import {
  datalinkStore,
  type DatalinkMessage,
  type AdscContractGroupInfo,
  type DatalinkCpdlcElement
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
  const label = contractGroupLabel[g.type] ?? g.type;
  if (g.interval_secs != null) return `${label}: every ${g.interval_secs}s`;
  if (g.modulus != null) return `${label} (mod ${g.modulus})`;
  if (g.threshold_nm != null) return `${label}: ±${g.threshold_nm} nm`;
  if (g.threshold_fpm != null) return `${label}: >${g.threshold_fpm} fpm`;
  if (g.ceiling_ft != null) return `${label}: ${g.floor_ft}–${g.ceiling_ft} ft`;
  if (g.projection_time_mins != null) return `${label}: ${g.projection_time_mins} min`;
  return label;
};

// ── CPDLC element rendering ─────────────────────────────────────────────

/** Format a raw element name like "uM20Altitude" → "uM20" */
const formatElName = (name: string): string => {
  // names look like "dM0NULL", "uM163ICAOfacilitydesignationTp4table"
  const m = name.match(/^([ud]M\d+)/i);
  return m ? m[1] : name.slice(0, 8);
};

const formatControlType = (t: string): string => {
  if (t === "connect_request") return "LOGON REQUEST";
  if (t === "connect_confirm") return "LOGON ACCEPTED";
  if (t === "disconnect_request") return "LOGOFF";
  return t.replace(/_/g, " ").toUpperCase();
};

/** Format a CpdlcAltitude blob → string */
const fmtAltitude = (a: any): string => {
  if (!a) return "?";
  if (a.FL != null) return `FL${a.FL}`;
  if (a.ft != null) return `${a.ft} ft`;
  if (a.Metric) return `${a.Metric.value} ${a.Metric.unit}`;
  const v = a.value ?? a.altitude;
  return v != null ? `${v} ft` : JSON.stringify(a);
};

const fmtFrequency = (f: any): string => {
  if (!f) return "?";
  const khz = f.value;
  if (f.type === "VhfKhz") return `${(khz / 1000).toFixed(3)} MHz`;
  if (f.type === "HfKhz") return `${(khz / 1000).toFixed(3)} MHz`;
  return `${khz} kHz`;
};

const fmtFacility = (fac: any): string => {
  if (!fac) return "?";
  if (fac.ICAO) return fac.ICAO;
  if (fac.type === "Name") return fac.value;
  if (fac.type === "Designation") return fac.value;
  return JSON.stringify(fac);
};

const fmtUnit = (u: any): string => {
  if (!u) return "?";
  const fac = fmtFacility(u.facility);
  const fn = u.function ?? "";
  return fn ? `${fac} ${fn}` : fac;
};

const fmtPosition = (p: any): string => {
  if (!p) return "?";
  if (p.type === "FixName") return p.value;
  if (p.type === "LatLong") {
    const lat = p.value?.latitude ?? p.latitude;
    const lon = p.value?.longitude ?? p.longitude;
    if (lat != null) return `${lat.toFixed(2)}°/${lon.toFixed(2)}°`;
  }
  if (p.type === "PlaceBearingDistance") {
    return `${fmtPosition(p.value?.place ?? p.place)} / ${p.value?.bearing ?? p.bearing}° / ${p.value?.distance ?? p.distance} nm`;
  }
  return p.value ?? JSON.stringify(p);
};

const fmtTime = (t: any): string => {
  if (!t) return "?";
  const h = String(t.hour ?? 0).padStart(2, "0");
  const m = String(t.minute ?? 0).padStart(2, "0");
  return `${h}:${m}`;
};

const fmtSpeed = (s: any): string => {
  if (!s) return "?";
  if (s.Knots != null) return `${s.Knots} kt`;
  if (s.Mach != null) return `M${s.Mach}`;
  if (s.km_h != null) return `${s.km_h} km/h`;
  return JSON.stringify(s);
};

const fmtTp4Table = (t: any): string => {
  if (!t) return "";
  if (t === "LabelA") return "label A";
  if (t === "LabelB") return "label B";
  return String(t);
};

/** Replace one [placeholder] token with its value from the body */
const fillToken = (token: string, body: any): string => {
  if (!body) return `[${token}]`;
  switch (token) {
    case "altitude":
      return fmtAltitude(body.altitude ?? body.first ?? body);
    case "altitude2":
      return fmtAltitude(body.second);
    case "frequency":
      return fmtFrequency(body.frequency);
    case "icaofacilitydesignation":
      return fmtFacility(body.facility);
    case "icaounitname":
      return fmtUnit(body.icao_unit ?? body.unit);
    case "position":
      return fmtPosition(
        body.position ?? (Array.isArray(body.positions) ? body.positions[0] : null)
      );
    case "position2":
      return fmtPosition(Array.isArray(body.positions) ? body.positions[1] : null);
    case "time":
      return fmtTime(body.time ?? (Array.isArray(body.times) ? body.times[0] : null));
    case "time2":
      return fmtTime(Array.isArray(body.times) ? body.times[1] : null);
    case "speed":
      return fmtSpeed(
        body.speed ?? (Array.isArray(body.speeds) ? body.speeds[0] : null)
      );
    case "speed2":
      return fmtSpeed(Array.isArray(body.speeds) ? body.speeds[1] : null);
    case "beaconcode":
      return body.beacon_code ?? "?";
    case "tp4table":
      return fmtTp4Table(body.tp4_table ?? body.tp4table);
    case "direction":
      return String(body.direction ?? "?");
    case "degrees":
      return body.degrees != null ? `${body.degrees}°` : "?";
    case "distance":
      return body.distance?.value != null ? `${body.distance.value} nm` : "?";
    case "errorinformation":
      return String(body.error_information ?? "?");
    case "atisdesignator":
      return body.atis_code ?? body.atis ?? "?";
    case "procedurename":
      return body.procedure_name?.name ?? JSON.stringify(body.procedure_name);
    default:
      return `[${token}]`;
  }
};

/**
 * Fill a CPDLC template string like
 *   "CONTACT [icaounitname] [frequency]"
 * with body values, returning a human-readable sentence.
 */
const fillTemplate = (el: DatalinkCpdlcElement): string => {
  const body = el.body as any;
  // Free-text elements: body carries the text directly
  if (body?.free_text) return body.free_text;
  // No template: fall back to formatted name
  if (!el.template) {
    if (!body) return formatElName(el.name).toUpperCase();
    return formatElName(el.name);
  }
  // Fill [placeholder] tokens
  return el.template.replace(/\[([a-z0-9]+)\]/gi, (_, token) =>
    fillToken(token.toLowerCase(), body)
  );
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

const formatTime = (ts: number | undefined) => {
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
/* dir-badge removed — replaced by dir-bubble */
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
