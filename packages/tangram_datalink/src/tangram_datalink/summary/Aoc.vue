<template>
  <SummaryRows :rows="rows" empty="aoc" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage, Label5zPayload, SummaryRow } from "../types";
import SummaryRows from "./Rows.vue";

defineOptions({ name: "DatalinkSummaryAoc" });

const props = defineProps<{ msg: DatalinkMessage }>();

// 1h sample: AOC-ish 228, ATIS 159, oceanic 27
const time = (value: string | undefined) => (value ? `${value}Z` : null);
const label5zRows = (data: Label5zPayload): SummaryRow[] => {
  const important = data.fields.filter(field =>
    ["IR", "ETA", "WC", "UM"].includes(field.key)
  );
  return [
    {
      meta: "label 5Z",
      detail:
        important
          .slice(0, 5)
          .map(field => [field.key, field.value].filter(Boolean).join(" "))
          .join(" · ") || `${data.fields.length} fields`
    },
    ...(data.remarks ? [{ meta: "remarks", detail: data.remarks }] : [])
  ];
};

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (!app || typeof app === "string") return [];

  if ("oceanic_clearance" in app) {
    const data = app.oceanic_clearance;
    const clearance = [data.clearance_type, data.clearance_number]
      .filter(Boolean)
      .join(" ");
    return [
      {
        meta: "oceanic",
        detail: [data.facility, clearance || null, data.flight_id]
          .filter(Boolean)
          .join(" · ")
      },
      {
        meta: "entry",
        detail: [data.entry_point, time(data.entry_time), data.mach, data.flight_level]
          .filter(Boolean)
          .join(" · ")
      }
    ].filter(row => row.detail);
  }

  if ("atis_request" in app) {
    const data = app.atis_request;
    return [
      {
        meta: "ATIS req",
        detail: [
          data.airport,
          `current ${data.current_atis}`,
          `offset ${data.offset}`
        ].join(" · ")
      }
    ];
  }

  if ("atis_delivery" in app) {
    const data = app.atis_delivery;
    return [
      {
        meta: "ATIS",
        detail: [data.airport, data.kind, data.atis_letter, data.issued_time]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }

  if ("weather" in app) {
    const reports = app.weather.reports ?? [];
    const first = reports[0];
    return [
      {
        meta: "weather",
        detail: [
          reports.length ? `${reports.length} reports` : null,
          reports
            .map(report => report.station)
            .slice(0, 4)
            .join(" ") || null,
          first ? [first.day, first.time].filter(Boolean).join("/") : null
        ]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }

  if ("aoc_report" in app) {
    const data = app.aoc_report;
    return [
      {
        meta: data.msg_type,
        detail: [
          data.flight_number,
          data.departure && data.destination
            ? `${data.departure} → ${data.destination}`
            : null,
          time(data.eta),
          data.flight_level == null ? null : `FL${data.flight_level}`
        ]
          .filter(Boolean)
          .join(" · ")
      }
    ].filter(row => row.detail);
  }

  if ("label_5z" in app) return label5zRows(app.label_5z);

  if ("label_32" in app) {
    const data = app.label_32;
    return [
      {
        meta: "label 32",
        detail: [
          data.timestamp ? `${data.timestamp}Z` : null,
          data.latitude != null && data.longitude != null
            ? `${data.latitude.toFixed(2)} ${data.longitude.toFixed(2)}`
            : null,
          data.altitude_ft == null ? null : `${data.altitude_ft} ft`,
          `${data.fields.length} fields`
        ]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }

  if ("label_16" in app) {
    const data = app.label_16;
    return [
      {
        meta: "label 16",
        detail: [
          data.timestamp ? `${data.timestamp}Z` : null,
          `${data.fields.length} fields`
        ]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }

  if ("label_37" in app) {
    const data = app.label_37;
    return [
      {
        meta: "label 37",
        detail: [`${data.line_count} lines`, data.prefix].filter(Boolean).join(" · ")
      }
    ];
  }
  return [];
});
</script>
