<template>
  <SummaryRows :rows="rows" empty="position" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type {
  DatalinkMessage,
  LinkType,
  PositionLikePayload,
  SummaryRow
} from "../types";
import SummaryRows from "./Rows.vue";

defineOptions({ name: "DatalinkSummaryPosition" });

const props = defineProps<{ msg: DatalinkMessage }>();

const formatCoord = (value: number, pos: string, neg: string) =>
  `${Math.abs(value).toFixed(2)}°${value < 0 ? neg : pos}`;

const linkLabel = (link: LinkType) => {
  switch (link) {
    case "VhfAcars":
      return "VHF ACARS";
    case "Vdl2":
      return "VDL2";
    case "Hf":
      return "HF";
    case "IcoSatcom":
      return "ICO SATCOM";
    default:
      return link.toUpperCase();
  }
};

const positionRow = (
  meta: string,
  data: PositionLikePayload,
  fields?: string[]
): SummaryRow[] =>
  [
    {
      meta,
      detail: [
        data.latitude == null || data.longitude == null
          ? null
          : `${formatCoord(data.latitude, "N", "S")} ${formatCoord(data.longitude, "E", "W")}`,
        data.altitude_ft == null ? null : `${Math.round(data.altitude_ft)} ft`,
        data.heading_deg == null ? null : `${Math.round(data.heading_deg)}°`,
        data.timestamp ? `${data.timestamp}Z` : null,
        fields?.length ? `${fields.length} fields` : null
      ]
        .filter(Boolean)
        .join(" · ")
    },
    ...(data.departure || data.destination
      ? [
          {
            meta: "route",
            detail:
              data.departure && data.destination
                ? `${data.departure} → ${data.destination}`
                : (data.departure ?? data.destination)
          }
        ]
      : [])
  ].filter(row => row.detail);

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (!app || typeof app === "string") return [];
  if ("aoc_position" in app)
    return positionRow(app.aoc_position.format, app.aoc_position);
  if ("label_32" in app)
    return positionRow("label 32", app.label_32, app.label_32.fields);
  if ("media_advisory" in app) {
    const data = app.media_advisory;
    const alternates = data.available_links.filter(link => link !== data.current_link);
    return [
      {
        meta: "media",
        detail: [
          `${data.state.toLowerCase()} ${linkLabel(data.current_link)}`,
          `${data.time_utc}Z`,
          alternates.length ? `also ${alternates.map(linkLabel).join("/")}` : null,
          data.text
        ]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }
  return [];
});
</script>
