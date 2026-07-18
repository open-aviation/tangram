<template>
  <div class="minisky-count" :title="title">
    <span class="plane-icon">▲</span>
    <span class="count">{{ miniskyStore.siminfo?.ntraf ?? 0 }}</span>
    <span class="state" :class="stateClass">
      {{ miniskyStore.connected ? (miniskyStore.siminfo?.state_name ?? "—") : "OFF" }}
    </span>
    <span v-if="miniskyStore.connected && miniskyStore.siminfo" class="simt">
      {{ simTime }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { miniskyStore } from "./store";

const simTime = computed(() => {
  const t = Math.floor(miniskyStore.siminfo?.simt ?? 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
});

const stateClass = computed(() => {
  if (!miniskyStore.connected) return "off";
  switch (miniskyStore.siminfo?.state_name) {
    case "OP":
      return "op";
    case "HOLD":
      return "hold";
    default:
      return "init";
  }
});

const title = computed(() =>
  miniskyStore.connected
    ? `MiniSky · ${miniskyStore.siminfo?.scenname || "no scenario"} · ${
        miniskyStore.siminfo?.speed ?? 1
      }x`
    : "MiniSky simulator not connected"
);
</script>

<style scoped>
.minisky-count {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 10pt;
  color: var(--t-fg);
  white-space: nowrap;
}

.plane-icon {
  color: #f9fd15;
  text-shadow: 0 0 2px #0014aa;
}

.count {
  font-weight: bold;
}

.simt {
  color: var(--t-muted);
  font-variant-numeric: tabular-nums;
}

.state {
  font-size: 8pt;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 8px;
}

.state.op {
  background: #1c7c2e;
  color: #ffffff;
}

.state.hold {
  background: #b58900;
  color: #ffffff;
}

.state.init {
  background: var(--t-border);
  color: var(--t-fg);
}

.state.off {
  background: #7c1c1c;
  color: #ffffff;
}
</style>
