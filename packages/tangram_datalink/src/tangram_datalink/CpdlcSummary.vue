<template>
  <MessageSummaryParts :parts="parts" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import MessageSummaryParts from "./MessageSummaryParts.vue";
import type { DatalinkMessage } from "./store";
import {
  arinc622Message,
  arrayField,
  decodedArincPayload,
  isRecord,
  stringField
} from "./summary_helpers";

const props = defineProps<{ msg: DatalinkMessage }>();

const sideParts = (side: unknown, direction: string) => {
  const elements = arrayField(side, "elements");
  const ids = elements
    .filter(isRecord)
    .map(element => element.id)
    .filter(id => typeof id === "number" || typeof id === "string")
    .slice(0, 4)
    .map(id => `#${id}`);
  return [direction, ids.length ? ids.join(" ") : null].filter(Boolean) as string[];
};

const parts = computed(() => {
  const arinc = arinc622Message(props.msg);
  const payload = decodedArincPayload(props.msg);
  const out: string[] = [];

  if (isRecord(payload)) {
    if (isRecord(payload.downlink))
      out.push(...sideParts(payload.downlink, "downlink"));
    else if (isRecord(payload.uplink)) out.push(...sideParts(payload.uplink, "uplink"));
    else if (isRecord(payload.control)) {
      out.push("control");
      const kind = stringField(payload.control, "kind");
      if (kind) out.push(kind);
    }
  }

  if (arinc?.imi) out.push(arinc.imi);
  if (arinc?.atsu_address) out.push(arinc.atsu_address);
  return out.length ? out : ["cpdlc"];
});
</script>
