<template>
  <SummaryRows :rows="rows" empty="afn" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage, SummaryRow } from "../types";
import { arinc622Message } from "../summary_helpers";
import SummaryRows from "./Rows.vue";

defineOptions({ name: "DatalinkSummaryAfn" });

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (!app || typeof app === "string" || !("afn" in app)) {
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

  const data = app.afn;
  const applications = (data.applications ?? [])
    .map(application => [application.code, application.value].filter(Boolean).join(" "))
    .filter(Boolean);
  return [
    {
      meta: `AFN ${data.message_type}`,
      detail: [data.facility, data.flight_id, data.registration, data.icao24]
        .filter(Boolean)
        .join(" · ")
    },
    ...(applications.length
      ? [{ meta: "apps", detail: applications.slice(0, 4).join(" · ") }]
      : [])
  ].filter(row => row.detail);
});
</script>
