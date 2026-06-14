<template>
  <SummaryRows :rows="rows" empty="afn" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage } from "../types";
import { arinc622Message } from "../summary_helpers";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

defineOptions({ name: "DatalinkSummaryAfn" });

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (app?.kind !== "afn") {
    const arinc = arinc622Message(props.msg);
    return arinc?.imi === "AFN" || arinc?.imi === "ATS"
      ? [
          {
            meta: `AFN ${arinc.imi}`,
            detail: [arinc.atsu_address, arinc.registration].filter(Boolean).join(" · ")
          }
        ].filter(row => row.detail)
      : [];
  }
  const data = app.data;
  const apps = (data.applications ?? [])
    .map(app => [app.code, app.value].filter(Boolean).join(" "))
    .filter(Boolean);

  return [
    {
      meta: `AFN ${data.message_type}`,
      detail: [data.facility, data.flight_id, data.registration, data.icao24]
        .filter(Boolean)
        .join(" · ")
    },
    ...(apps.length ? [{ meta: "apps", detail: apps.slice(0, 4).join(" · ") }] : [])
  ].filter(row => row.detail);
});
</script>
