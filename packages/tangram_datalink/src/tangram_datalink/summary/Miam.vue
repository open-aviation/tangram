<template>
  <SummaryRows :rows="rows" empty="miam" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage } from "../types";
import type { OhmaPayload } from "../types";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

defineOptions({ name: "DatalinkSummaryMiam" });

const props = defineProps<{ msg: DatalinkMessage }>();

const label = (value: string) => value.replaceAll("_", " ");

const totalFlights = (data: OhmaPayload) =>
  data.airplanes.reduce((sum, airplane) => sum + (airplane.flights?.length ?? 0), 0);

const totalEvents = (data: OhmaPayload) =>
  data.airplanes.reduce(
    (sum, airplane) =>
      sum +
      (airplane.flights?.reduce(
        (flightSum, flight) => flightSum + (flight.events?.length ?? 0),
        0
      ) ?? 0),
    0
  );

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (app?.kind === "ohma") {
    const data = app.data;
    return [
      {
        meta: "OHMA",
        detail:
          [
            data.client_id,
            data.version,
            data.airplanes.length ? `${data.airplanes.length} aircraft` : null,
            totalFlights(data) ? `${totalFlights(data)} flights` : null,
            totalEvents(data) ? `${totalEvents(data)} events` : null,
            data.msg_seq && data.msg_total
              ? `part ${data.msg_seq}/${data.msg_total}`
              : null
          ]
            .filter(Boolean)
            .join(" · ") || "health monitoring"
      }
    ];
  }

  if (app?.kind === "miam") {
    const data = app.data;
    const frame = data.frame_id;
    const pdu = typeof data.core.kind === "string" ? data.core.kind : null;
    return [
      {
        meta: "MIAM",
        detail:
          [frame && label(frame), pdu && label(pdu)].filter(Boolean).join(" · ") ||
          "decoded"
      }
    ];
  }

  return [];
});
</script>
