<template>
  <SummaryRows :rows="rows" empty="position" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage } from "../types";
import type { LinkType, PositionLikePayload } from "../types";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

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

const mediaAdvisoryDetail = (data: {
  state: string;
  current_link: LinkType;
  time_utc: string;
  available_links: LinkType[];
  text?: string;
}) => {
  const alternates = data.available_links.filter(link => link !== data.current_link);
  return [
    `${data.state.toLowerCase()} ${linkLabel(data.current_link)}`,
    `${data.time_utc}Z`,
    alternates.length ? `also ${alternates.map(linkLabel).join("/")}` : null,
    data.text
  ]
    .filter(Boolean)
    .join(" · ");
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
  if (app?.kind === "aoc_position") return positionRow(app.data.format, app.data);
  if (app?.kind === "label_32")
    return positionRow("label 32", app.data, app.data.fields);
  if (app?.kind === "media_advisory") {
    return [
      {
        meta: "media",
        detail: mediaAdvisoryDetail(app.data)
      }
    ];
  }
  return [];
});
</script>
