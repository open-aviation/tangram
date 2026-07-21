<template>
  <SummaryRows :rows="rows" empty="message" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DatalinkMessage, SummaryRow } from "../types";
import { arinc622Message, rawMessage } from "../summary_helpers";
import { arinc622PayloadKind } from "../store";
import SummaryRows from "./Rows.vue";

defineOptions({ name: "DatalinkSummaryDefaultMessage" });

const props = defineProps<{ msg: DatalinkMessage }>();

const rows = computed<SummaryRow[]>(() => {
  const arinc = arinc622Message(rawMessage(props.msg));
  if (!arinc) return [];
  const seen = new Set<string>();
  const parts = [arinc.imi, arinc622PayloadKind(arinc.payload)].filter(value => {
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts.length ? [{ meta: "message", detail: parts.join(" · ") }] : [];
});
</script>
