<template>
  <MessageSummaryParts :parts="parts" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import MessageSummaryParts from "./MessageSummaryParts.vue";
import type { DatalinkMessage } from "./store";
import { arinc622Message, isRecord, rawMessage, stringField } from "./summary_helpers";

const props = defineProps<{ msg: DatalinkMessage }>();

const parts = computed(() => {
  const raw = rawMessage(props.msg);
  const arinc = arinc622Message(raw);
  const payloadKind = stringField(
    isRecord(arinc?.payload) ? arinc.payload : undefined,
    "kind"
  );
  const seen = new Set<string>();
  return [arinc?.imi, payloadKind].filter((value): value is string => {
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});
</script>
