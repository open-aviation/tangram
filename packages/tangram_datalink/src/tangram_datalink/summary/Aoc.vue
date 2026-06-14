<template>
  <SummaryRows :rows="rows" empty="aoc" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage } from "../types";
import type { Label5zPayload } from "../types";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

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
  switch (app?.kind) {
    case "oceanic_clearance": {
      const data = app.data;
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
          detail: [
            data.entry_point,
            time(data.entry_time),
            data.mach,
            data.flight_level
          ]
            .filter(Boolean)
            .join(" · ")
        }
      ].filter(row => row.detail);
    }
    case "atis_request": {
      const data = app.data;
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
    case "atis_delivery": {
      const data = app.data;
      return [
        {
          meta: "ATIS",
          detail: [data.airport, data.kind, data.atis_letter, data.issued_time]
            .filter(Boolean)
            .join(" · ")
        }
      ];
    }
    case "weather": {
      const reports = app.data.reports ?? [];
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
    case "aoc_report": {
      const data = app.data;
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
    case "label_5z":
      return label5zRows(app.data);
    case "label_32":
      return [
        {
          meta: "label 32",
          detail: [
            app.data.timestamp ? `${app.data.timestamp}Z` : null,
            app.data.latitude != null && app.data.longitude != null
              ? `${app.data.latitude.toFixed(2)} ${app.data.longitude.toFixed(2)}`
              : null,
            app.data.altitude_ft == null ? null : `${app.data.altitude_ft} ft`,
            `${app.data.fields.length} fields`
          ]
            .filter(Boolean)
            .join(" · ")
        }
      ];
    case "label_16":
      return [
        {
          meta: "label 16",
          detail: [
            app.data.timestamp ? `${app.data.timestamp}Z` : null,
            `${app.data.fields.length} fields`
          ]
            .filter(Boolean)
            .join(" · ")
        }
      ];
    case "label_37":
      return [
        {
          meta: "label 37",
          detail: [`${app.data.line_count} lines`, app.data.prefix]
            .filter(Boolean)
            .join(" · ")
        }
      ];
    default:
      return [];
  }
});
</script>
