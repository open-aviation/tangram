<template>
  <SummaryRows :rows="rows" empty="cpdlc">
    <template #default="{ row }">
      <span class="cpdlc-phrase">
        <template v-for="(part, partIdx) in row.parts ?? []" :key="partIdx">
          <span v-if="part.kind === 'value'" class="cpdlc-value">{{ part.text }}</span>
          <span v-else class="cpdlc-text">{{ part.text }}</span>
        </template>
      </span>
    </template>
  </SummaryRows>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  CpdlcElement,
  DatalinkMessage,
  PhraseSummaryRow,
  SummaryPhrasePart
} from "../types";
import { arinc622Message, isRecord } from "../summary_helpers";
import SummaryRows from "./Rows.vue";
defineOptions({ name: "DatalinkSummaryCpdlc" });

const props = defineProps<{ msg: DatalinkMessage }>();

type PhrasePart = SummaryPhrasePart;
type PhraseRow = PhraseSummaryRow;

const label = (value: string) => value.replaceAll("_", " ");

const controlLabel = (kind: string) => {
  switch (kind) {
    case "connect_request":
      return "connect request";
    case "connect_confirm":
      return "connect confirm";
    case "disconnect_request":
      return "disconnect request";
    default:
      return label(kind);
  }
};

const primitive = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const formatTime = (value: Record<string, unknown>) => {
  const hour = typeof value.hour === "number" ? value.hour : null;
  const minute = typeof value.minute === "number" ? value.minute : null;
  const second = typeof value.second === "number" ? value.second : null;
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}${second == null ? "" : String(second).padStart(2, "0")}Z`;
};

const formatVariant = (kind: string, data: unknown): string | null => {
  const direct = primitive(data);
  switch (kind) {
    case "flight_level":
      return direct == null ? null : `FL${direct}`;
    case "flight_level_metric":
      return direct == null ? null : `FL${direct}m`;
    case "qnh_feet":
    case "qfe_feet":
    case "gnss_feet":
      return direct == null ? null : `${direct} ft`;
    case "qnh_meters":
    case "qfe_meters":
    case "gnss_meters":
      return direct == null ? null : `${direct} m`;
    case "icao":
    case "designation":
    case "name":
    case "fix_name":
    case "navaid":
    case "airport":
      return direct;
    case "hf_khz":
      return direct == null ? null : `${direct} kHz`;
    case "vhf_khz":
      return typeof data === "number" ? `${(data / 1000).toFixed(3)} MHz` : direct;
    case "indicated_knots":
    case "true_knots":
    case "ground_knots":
      return direct == null ? null : `${direct} kt`;
    case "indicated_kmh":
    case "true_kmh":
    case "ground_kmh":
      return direct == null ? null : `${direct} km/h`;
    case "mach":
    case "mach_large":
      return typeof data === "number" ? `M${(data / 100).toFixed(2)}` : direct;
    case "nm":
    case "nautical_miles":
      return direct == null ? null : `${direct} nm`;
    case "km":
    case "kilometers":
      return direct == null ? null : `${direct} km`;
    case "feet_per_minute":
      return direct == null ? null : `${direct} fpm`;
    case "meters_per_minute":
      return direct == null ? null : `${direct} m/min`;
    case "in_hg_hundredths":
      return typeof data === "number" ? `${(data / 100).toFixed(2)} inHg` : direct;
    case "hecto_pascals":
      return direct == null ? null : `${direct} hPa`;
    case "magnetic":
      return direct == null ? null : `${direct}°M`;
    case "true":
      return direct == null ? null : `${direct}°T`;
    case "latitude_longitude":
      if (!isRecord(data)) return direct;
      return typeof data.latitude === "number" && typeof data.longitude === "number"
        ? `${data.latitude.toFixed(2)}° ${data.longitude.toFixed(2)}°`
        : null;
    default:
      return direct ?? `${label(kind)} ${formatValue(data)}`;
  }
};

const formatValue = (value: unknown): string => {
  const direct = primitive(value);
  if (direct != null) return direct;
  if (Array.isArray(value)) return value.map(formatValue).join(" / ");
  if (!isRecord(value)) return "—";
  const time = formatTime(value);
  if (time) return time;

  const entries = Object.entries(value);
  if (entries.length === 1) {
    const [kind, data] = entries[0];
    return formatVariant(kind, data) ?? label(kind);
  }
  return entries
    .map(([key, entry]) => `${label(key)} ${formatValue(entry)}`)
    .join(" · ");
};

const resolveSlot = (element: CpdlcElement, slot: string): unknown => {
  const body = element.body;
  if (!body || body === "unsupported") return undefined;
  const entries = Object.entries(body);
  if (entries.length !== 1) return undefined;
  const [kind, data] = entries[0];
  if (kind === slot) return data;
  return isRecord(data) && slot in data ? data[slot] : undefined;
};

const renderElement = (element: CpdlcElement): PhrasePart[] => {
  if (!element.fragments.length)
    return [{ kind: "text", text: element.catalog_name || `element ${element.id}` }];

  return element.fragments.map(fragment => {
    if ("text" in fragment) return { kind: "text", text: fragment.text };
    const slot = fragment.value;
    const value = resolveSlot(element, slot);
    return {
      kind: "value",
      text: value === undefined ? `${label(slot)}?` : formatValue(value)
    };
  });
};

const sideRows = (elements: CpdlcElement[], direction: string): PhraseRow[] =>
  elements.map(element => ({
    meta: `${controlLabel(direction)} ${element.is_additional ? "+" : "#"}${element.id}`,
    parts: renderElement(element)
  }));

const rows = computed(() => {
  const arinc = arinc622Message(props.msg);
  if (!arinc || !("cpdlc" in arinc.payload)) return [];
  const payload = arinc.payload.cpdlc;

  const out: PhraseRow[] = [];
  if (payload.downlink) out.push(...sideRows(payload.downlink.elements, "downlink"));
  if (payload.uplink) out.push(...sideRows(payload.uplink.elements, "uplink"));

  const control = payload.control;
  if (control && control !== "disconnect_request") {
    const kind = "connect_request" in control ? "connect_request" : "connect_confirm";
    const side =
      "connect_request" in control
        ? control.connect_request.message
        : control.connect_confirm.message;
    if (side) out.push(...sideRows(side.elements, kind));
  }
  if (!out.length && control) {
    const kind =
      control === "disconnect_request"
        ? control
        : "connect_request" in control
          ? "connect_request"
          : "connect_confirm";
    out.push({ meta: "control", parts: [{ kind: "text", text: controlLabel(kind) }] });
  }
  return out.slice(0, 4);
});
</script>

<style scoped>
.cpdlc-phrase {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}
.cpdlc-text {
  white-space: pre-wrap;
}
.cpdlc-value {
  display: inline-block;
  max-width: 100%;
  margin: 0 1px;
  --cpdlc-value-color: oklch(56% 0.15 300);
  border: 1px solid color-mix(in oklch, var(--cpdlc-value-color) 42%, var(--t-border));
  border-radius: 5px;
  background: color-mix(in oklch, var(--cpdlc-value-color) 14%, var(--t-bg));
  color: color-mix(in oklch, var(--cpdlc-value-color) 76%, var(--t-fg));
  font-family: "Inconsolata", monospace;
  font-weight: 700;
  line-height: 1.12;
  padding: 0 4px;
  vertical-align: baseline;
}
</style>
