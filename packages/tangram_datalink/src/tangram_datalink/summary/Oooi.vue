<template>
  <SummaryRows :rows="rows" empty="oooi" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageApp } from "../store";
import type { DatalinkMessage } from "../types";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

defineOptions({ name: "DatalinkSummaryOooi" });

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const app = messageApp(props.msg);
  if (app?.kind === "oooi_off_destination") {
    const data = app.data;
    return [
      {
        meta: "OFF dest",
        detail: `${data.departure} → ${data.destination} · ${data.time_utc}Z`
      },
      ...(data.extras ? [{ meta: "extras", detail: data.extras }] : [])
    ];
  }
  if (app?.kind === "oooi_off_report") {
    const data = app.data;
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
