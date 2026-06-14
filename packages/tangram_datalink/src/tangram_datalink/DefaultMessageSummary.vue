<template>
  <SummaryRows :rows="rows" empty="message" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DatalinkMessage } from "./store";
import { arinc622Message, rawMessage } from "./summary_helpers";
import SummaryRows from "./SummaryRows.vue";
import type { SummaryRow } from "./summary_rows";

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const raw = rawMessage(props.msg);
  const arinc = arinc622Message(raw);
  const seen = new Set<string>();
  const parts = [arinc?.imi, arinc?.payload?.kind].filter((value): value is string => {
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts.length ? [{ meta: "message", detail: parts.join(" · ") }] : [];
});
</script>
