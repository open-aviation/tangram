<template>
  <SummaryRows :rows="rows" empty="oooi" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage, SummaryRow } from "../types";
import SummaryRows from "./Rows.vue";

defineOptions({ name: "DatalinkSummaryOooi" });

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (!app || typeof app === "string") return [];
  if ("oooi_off_destination" in app) {
    const data = app.oooi_off_destination;
    return [
      {
        meta: "OFF dest",
        detail: `${data.departure} → ${data.destination} · ${data.time_utc}Z`
      },
      ...(data.extras ? [{ meta: "extras", detail: data.extras }] : [])
    ];
  }
  if ("oooi_off_report" in app) {
    const data = app.oooi_off_report;
    return [
      {
        meta: "OFF report",
        detail: `${data.departure} → ${data.arrival} · ${data.time_utc}Z`
      },
      ...(data.extras ? [{ meta: "extras", detail: data.extras }] : [])
    ];
  }
  return [];
});
</script>
