<template>
  <div class="system-widget">
    <div
      class="clock"
      @mouseover="state.hovered = true"
      @mouseleave="state.hovered = false"
    >
      <span id="info_time">{{ state.hovered ? local_time : utc_time }}</span>
    </div>
    <span id="uptime">{{ state.uptime }}</span>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, inject, onMounted, onUnmounted } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const state = reactive({
  hovered: false,
  uptime: "",
  info_utc: new Date().getTime()
});

let subscription: Disposable | null = null;

onMounted(async () => {
  try {
    subscription = await tangramApi.realtime.subscribe(
      "system:update-node",
      (payload: { el: string; value: string | number }) => {
        if (payload.el === "uptime") state.uptime = payload.value as string;
        if (payload.el === "info_utc") state.info_utc = payload.value as number;
      }
    );
  } catch (e) {
    console.error("failed to subscribe to system:update-node", e);
  }
});

onUnmounted(() => {
  subscription?.dispose();
});

const utc_time = computed(() => {
  const date = new Date(state.info_utc);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds} Z`;
});

const local_time = computed(() => {
  const date = new Date(state.info_utc);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset"
  });
});
</script>

<style scoped>
#uptime {
  color: #79706e;
  font-size: 9pt;
  text-align: center;
}

.system-widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1px;
  border-bottom: 1px solid #ddd;
}
</style>
