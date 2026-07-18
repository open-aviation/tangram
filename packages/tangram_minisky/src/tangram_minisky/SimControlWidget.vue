<template>
  <div class="minisky-control">
    <div v-if="!miniskyStore.connected" class="offline">
      Simulator offline — start <code>minisky server</code>
    </div>

    <template v-else>
      <div class="status-grid">
        <span class="label">Scenario</span>
        <span class="value">{{ siminfo?.scenname || "—" }}</span>
        <span class="label">Sim time</span>
        <span class="value mono">{{ simTime }}</span>
        <span class="label">State</span>
        <span class="value">{{ siminfo?.state_name }} · {{ siminfo?.speed }}x</span>
        <span class="label">Aircraft</span>
        <span class="value">
          {{ siminfo?.ntraf ?? 0 }}
          <span v-if="(siminfo?.nconf_cur ?? 0) > 0" class="conflicts">
            · {{ siminfo?.nconf_cur }} conflict(s)
          </span>
        </span>
      </div>

      <div class="button-row">
        <button :class="{ active: siminfo?.state_name === 'OP' }" @click="send('OP')">
          ▶ Run
        </button>
        <button
          :class="{ active: siminfo?.state_name === 'HOLD' }"
          @click="send('HOLD')"
        >
          ⏸ Hold
        </button>
        <button @click="send('RESET')">↺ Reset</button>
      </div>

      <div class="button-row">
        <button
          v-for="s in [1, 5, 10, 50]"
          :key="s"
          :class="{ active: siminfo?.speed === s }"
          @click="send(`DTMULT ${s}`)"
        >
          {{ s }}x
        </button>
      </div>

      <form class="command-form" @submit.prevent="submitCommand">
        <input
          v-model="command"
          type="text"
          placeholder="stack command, e.g. CRE KL204 B744 52 4 90 FL300 250"
          spellcheck="false"
          @keydown.up.prevent="historyUp"
          @keydown.down.prevent="historyDown"
        />
      </form>

      <div v-if="log.length" class="command-log">
        <div v-for="(entry, i) in log" :key="i" :class="entry.kind">
          {{ entry.text }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { miniskyStore } from "./store";

const siminfo = computed(() => miniskyStore.siminfo);

const command = ref("");
const history: string[] = [];
let historyIndex = -1;

const log = ref<{ kind: "cmd" | "msg" | "err"; text: string }[]>([]);

const simTime = computed(() => {
  const t = Math.floor(siminfo.value?.simt ?? 0);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
});

const pushLog = (kind: "cmd" | "msg" | "err", text: string) => {
  if (!text) return;
  log.value.push({ kind, text });
  if (log.value.length > 50) log.value.splice(0, log.value.length - 50);
};

const send = async (cmd: string) => {
  pushLog("cmd", `> ${cmd}`);
  try {
    const res = await fetch(`/minisky/stack?cmd=${encodeURIComponent(cmd)}`);
    if (!res.ok) {
      pushLog("err", `simulator unreachable (${res.status})`);
      return;
    }
    const data = await res.json();
    pushLog("msg", data.message ?? "");
  } catch (e) {
    pushLog("err", `${e}`);
  }
};

const submitCommand = () => {
  const cmd = command.value.trim();
  if (!cmd) return;
  history.push(cmd);
  historyIndex = history.length;
  command.value = "";
  void send(cmd);
};

const historyUp = () => {
  if (historyIndex > 0) {
    historyIndex--;
    command.value = history[historyIndex];
  }
};

const historyDown = () => {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    command.value = history[historyIndex];
  } else {
    historyIndex = history.length;
    command.value = "";
  }
};
</script>

<style scoped>
.minisky-control {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 10pt;
  color: var(--t-fg);
}

.offline {
  color: var(--t-muted);
  font-style: italic;
}

.offline code {
  font-style: normal;
}

.status-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.75rem;
  row-gap: 0.15rem;
}

.label {
  color: var(--t-muted);
}

.value {
  text-align: right;
}

.mono {
  font-variant-numeric: tabular-nums;
}

.conflicts {
  color: #ff9d1c;
  font-weight: bold;
}

.button-row {
  display: flex;
  gap: 0.35rem;
}

.button-row button {
  flex: 1;
  padding: 3px 6px;
  font-size: 9pt;
  background: var(--t-bg);
  color: var(--t-fg);
  border: 1px solid var(--t-border);
  border-radius: 6px;
  cursor: pointer;
}

.button-row button:hover {
  border-color: var(--t-fg);
}

.button-row button.active {
  background: #1c7c2e;
  border-color: #1c7c2e;
  color: #ffffff;
}

.command-form input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font-family: monospace;
  font-size: 9pt;
  background: var(--t-bg);
  color: var(--t-fg);
  border: 1px solid var(--t-border);
  border-radius: 6px;
}

.command-log {
  max-height: 140px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 8.5pt;
  border-top: 1px solid var(--t-border);
  padding-top: 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.command-log .cmd {
  color: var(--t-muted);
}

.command-log .msg {
  white-space: pre-wrap;
}

.command-log .err {
  color: #ff6464;
}
</style>
