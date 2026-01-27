<template>
  <div class="aircraft-list">
    <div
      v-for="item in aircraftList"
      :key="item.id"
      class="list-item"
      :class="{ expanded: isExpanded(item.id) }"
    >
      <div class="header" @click="toggleExpand(item.id)">
        <div class="row main-row">
          <div class="left-group">
            <span v-if="item.state.callsign" class="callsign">{{
              item.state.callsign
            }}</span>
            <span v-else class="callsign no-data">[no callsign]</span>
            <span v-if="item.state.typecode" class="chip blue">{{
              item.state.typecode
            }}</span>
            <span class="chip yellow icao24">{{ item.state.icao24 }}</span>
          </div>
          <div class="right-group">
            <span v-if="item.state.groundspeed !== undefined"
              >{{ Math.round(item.state.groundspeed) }} kts</span
            >
            <span
              v-if="
                item.state.groundspeed !== undefined &&
                item.state.altitude !== undefined
              "
              class="sep"
              >·</span
            >
            <span v-if="item.state.altitude !== undefined"
              >{{ item.state.altitude }} ft</span
            >
          </div>
        </div>
        <div class="row sub-row">
          <div class="left-group registration">
            {{
              aircraft_information(item.state.icao24, item.state.registration)?.flag ||
              ""
            }}
            {{ item.state.registration }}
          </div>
          <div class="right-group">
            <span v-if="item.state.vertical_rate !== undefined"
              >{{ item.state.vertical_rate }} fpm</span
            >
            <span
              v-if="
                item.state.vertical_rate !== undefined && item.state.track !== undefined
              "
              class="sep"
              >·</span
            >
            <span v-if="item.state.track !== undefined"
              >{{ Math.round(item.state.track) }}°</span
            >
          </div>
        </div>
      </div>

      <div v-if="isExpanded(item.id)" class="details-body" @click.stop>
        <CityPairWidget :icao24="item.id" />

        <div v-if="getTrajectoryLength(item.id) > 0">
          <select
            class="plot-select"
            :value="getSelectedMetric(item.id)"
            @change="
              e => setSelectedMetric(item.id, (e.target as HTMLSelectElement).value)
            "
          >
            <option value="altitude">Altitude (in ft)</option>
            <option value="speed">Speed (in kts)</option>
            <option value="vertical_rate">Vertical rate (in ft/mn)</option>
            <option value="track">Directions</option>
          </select>
          <div class="chart-container">
            <LineChart
              class="chart"
              :data="getChartData(item.id)"
              :options="getChartOptions(item.id)"
            />
          </div>
        </div>
        <div v-else class="no-data-msg">No trajectory data available</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, reactive, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";
import type { Jet1090Aircraft } from ".";
import { aircraftStore } from "./store";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
  type TooltipItem
} from "chart.js";
import { aircraft_information } from "rs1090-wasm";
import { Line as LineChart } from "vue-chartjs";
import type { Chart } from "chart.js";
import CityPairWidget from "./CityPairWidget.vue";

type CorsairState = { x: number; y: number; draw?: boolean };
type BlinkState = { lastX: number; until: number; phaseStart: number };
type BlinkOptions = {
  durationMs: number;
  intervalMs: number;
  radius: number;
  color: string;
};
type BlinkChart = Chart<"line"> & {
  $blinkState?: Map<number, BlinkState>;
  $blinkTimer?: ReturnType<typeof setTimeout> | null;
};

const corsairPlugin = {
  id: "corsair",
  defaults: { width: 1, color: "#FF4949", dash: [3, 3] },
  afterInit: (chart: Chart<"line">) => {
    const corsairChart = chart as Chart<"line"> & { corsair?: CorsairState };
    corsairChart.corsair = { x: 0, y: 0 };
  },
  afterEvent: (
    chart: Chart<"line">,
    args: { inChartArea: boolean; event: { x: number; y: number } }
  ) => {
    const corsairChart = chart as Chart<"line"> & { corsair?: CorsairState };
    const { inChartArea } = args;
    const { x, y } = args.event;
    corsairChart.corsair = { x, y, draw: inChartArea };
    corsairChart.draw();
  },
  beforeDatasetsDraw: (
    chart: Chart<"line">,
    _args: unknown,
    opts: { width: number; color: string; dash: number[] }
  ) => {
    const corsairChart = chart as Chart<"line"> & { corsair?: CorsairState };
    const { ctx } = chart;
    const { top, bottom, left, right } = chart.chartArea;
    if (!corsairChart.corsair || !corsairChart.corsair.draw) return;
    const { x, y } = corsairChart.corsair;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = opts.width;
    ctx.strokeStyle = opts.color;
    ctx.setLineDash(opts.dash);
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top);
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.restore();
  }
};
const formatZuluTick = (value: number | string) => {
  const d = new Date(Number(value) * 1000);
  return d.toISOString().slice(11, 16);
};

const formatZuluTimestamp = (value: number) => {
  const d = new Date(Number(value) * 1000);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}Z`;
};

const getLastPointsInfo = (chart: Chart) => {
  const infos: Array<{
    datasetIndex: number;
    x: number;
    y: number;
    valueX: number;
    color: string;
  }> = [];

  chart.data.datasets.forEach((dataset, datasetIndex) => {
    const data = dataset.data as
      | Array<{ x: number; y: number } | number | null>
      | undefined;
    if (!data || data.length === 0) return;
    const lastPoint = data[data.length - 1];
    if (!lastPoint) return;
    const x = typeof lastPoint === "number" ? null : lastPoint.x;
    if (x == null || !Number.isFinite(x)) return;

    const meta = chart.getDatasetMeta(datasetIndex);
    const element = meta.data?.[data.length - 1];
    if (!element) return;

    infos.push({
      datasetIndex,
      x: element.x,
      y: element.y,
      valueX: x,
      color: dataset.borderColor ?? dataset.backgroundColor ?? "#000"
    });
  });

  return infos;
};

const blinkLastPointPlugin = {
  id: "blinkLastPoint",
  defaults: { durationMs: 1200, intervalMs: 600, radius: 3, color: "#000" },
  afterDatasetsDraw: (chart: BlinkChart, _args: unknown, opts: BlinkOptions) => {
    const infos = getLastPointsInfo(chart);
    if (infos.length === 0) return;

    const now = Date.now();
    const state = chart.$blinkState || new Map<number, BlinkState>();
    chart.$blinkState = state;

    let hasActiveBlink = false;

    for (const info of infos) {
      const current = state.get(info.datasetIndex);
      if (!current || current.lastX !== info.valueX) {
        state.set(info.datasetIndex, {
          lastX: info.valueX,
          until: now + opts.durationMs,
          phaseStart: now
        });
      }

      const entry = state.get(info.datasetIndex);
      if (!entry || now >= entry.until) continue;

      const phase = Math.floor((now - entry.phaseStart) / opts.intervalMs) % 2;
      if (phase === 0) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = info.color;
        ctx.lineWidth = 1;
        ctx.arc(info.x, info.y, opts.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      hasActiveBlink = true;
    }

    if (hasActiveBlink && !chart.$blinkTimer) {
      chart.$blinkTimer = setTimeout(() => {
        chart.$blinkTimer = null;
        chart.draw();
      }, opts.intervalMs);
    }
  },
  beforeDestroy: (chart: BlinkChart) => {
    if (chart.$blinkTimer) {
      clearTimeout(chart.$blinkTimer);
      chart.$blinkTimer = null;
    }
  }
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  Title,
  Tooltip,
  Legend,
  Filler,
  corsairPlugin,
  blinkLastPointPlugin
);

const PLUGINS = {
  tooltip: {
    backgroundColor: "#f7f7f7",
    borderColor: "#ddd",
    borderWidth: 1,
    titleColor: "#000",
    bodyColor: "#000",
    titleFont: { family: "B612", size: 10 },
    bodyFont: { family: "B612", size: 10 },
    mode: "nearest" as const,
    intersect: true
  },
  filler: { propagate: true },
  corsair: { color: "black" },
  legend: {
    display: true,
    position: "top" as const,
    labels: {
      font: { family: "B612", size: 10 },
      usePointStyle: true,
      pointStyle: "line" as const
    }
  }
};
const X_SCALE = {
  type: "linear" as const,
  ticks: {
    font: { family: "B612", size: 9 },
    autoSkip: true,
    maxTicksLimit: 7,
    maxRotation: 0,
    minRotation: 0,
    padding: 5,
    callback: (value: number | string) => formatZuluTick(value)
  },
  border: { width: 0 },
  grid: { display: true }
};

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const expandedIds = reactive(new Set<string>());
const selectedMetrics = reactive(new Map<string, string>());

const aircraftList = computed(() => {
  const list = [];
  for (const [id, entity] of tangramApi.state.activeEntities.value) {
    if (entity.type === "jet1090_aircraft") {
      list.push({ id, state: entity.state as Jet1090Aircraft });
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
});

const isExpanded = (id: string) => {
  return aircraftList.value.length === 1 || expandedIds.has(id);
};

const toggleExpand = (id: string) => {
  if (aircraftList.value.length === 1) return;
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
};

const getTrajectoryLength = (id: string) => {
  return aircraftStore.selected.get(id)?.trajectory.length || 0;
};

const getSelectedMetric = (id: string) => selectedMetrics.get(id) || "altitude";
const setSelectedMetric = (id: string, val: string) => selectedMetrics.set(id, val);

const toPoint = (
  timestamp: number | null | undefined,
  y: number | null | undefined
) => {
  if (timestamp == null || y == null) return null;
  return { x: timestamp, y };
};

const toSeries = <T,>(
  data: T[],
  getTimestamp: (item: T) => number | null | undefined,
  getValue: (item: T) => number | null | undefined
) =>
  data
    .map(item => toPoint(getTimestamp(item), getValue(item)))
    .filter((point): point is { x: number; y: number } => point !== null);

const getMetricData = (traj: Jet1090Aircraft[], metric: string) => {
  if (metric === "altitude") {
    return traj.filter(item => item.altitude || item.selected_altitude);
  }
  if (metric === "speed") {
    return traj.filter(item => item.groundspeed || item.ias || item.tas || item.mach);
  }
  if (metric === "vertical_rate") {
    return traj.filter(
      item => item.vrate_barometric || item.vrate_inertial || item.vertical_rate
    );
  }
  return traj.filter(item => item.track || item.heading || item.roll);
};

const getTimestampDomain = (data: Jet1090Aircraft[]) => {
  const timestamps = data
    .map(item => item.timestamp)
    .filter((t): t is number => t != null && Number.isFinite(t));
  if (timestamps.length === 0) return {};
  return {
    min: Math.min(...timestamps),
    max: Math.max(...timestamps)
  };
};

const getChartData = (id: string): ChartData<"line"> => {
  const traj = aircraftStore.selected.get(id)?.trajectory || [];
  const metric = getSelectedMetric(id);

  if (metric === "altitude") {
    const data = getMetricData(traj, metric);
    return {
      datasets: [
        {
          label: "Barometric altitude",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.altitude
          ),
          borderColor: "#4c78a8",
          backgroundColor: "#9ecae9",
          borderWidth: 2,
          order: 2,
          pointRadius: 0,
          spanGaps: true,
          fill: { target: "origin" }
        },
        {
          label: "Selected altitude",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.selected_altitude
          ),
          borderColor: "#f58518",
          borderWidth: 3,
          order: 1,
          spanGaps: true,
          pointRadius: 0.2
        }
      ]
    };
  } else if (metric === "speed") {
    const data = getMetricData(traj, metric);
    return {
      datasets: [
        {
          label: "Ground speed",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.groundspeed
          ),
          borderColor: "#4c78a8",
          borderWidth: 2,
          pointRadius: 0.01,
          spanGaps: true,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "IAS",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.ias
          ),
          borderColor: "#f58518",
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 0.2,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "TAS",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.tas
          ),
          borderColor: "#54a24b",
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 0.2,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "Mach",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.mach
          ),
          borderColor: "#b79a20",
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 0.2,
          tension: 0.4,
          yAxisID: "mach"
        }
      ]
    };
  } else if (metric === "vertical_rate") {
    const data = getMetricData(traj, metric);
    return {
      datasets: [
        {
          label: "Vertical rate",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.vertical_rate
          ),
          borderColor: "#4c78a8",
          borderWidth: 1,
          pointRadius: 0.2,
          spanGaps: true,
          tension: 0.4
        },
        {
          label: "Barometric",
          showLine: false,
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.vrate_barometric
          ),
          borderWidth: 0.5,
          pointRadius: 1.5,
          borderColor: "#f58518",
          backgroundColor: "#f58518"
        },
        {
          label: "Inertial",
          showLine: false,
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.vrate_inertial
          ),
          borderWidth: 0.5,
          pointRadius: 1.5,
          borderColor: "#54a24b",
          backgroundColor: "#54a24b"
        }
      ]
    };
  } else {
    // track
    const data = getMetricData(traj, metric);
    return {
      datasets: [
        {
          label: "Track",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.track
          ),
          borderWidth: 2,
          borderColor: "#4c78a8",
          pointRadius: 0.2,
          spanGaps: true,
          yAxisID: "bearing"
        },
        {
          label: "Magnetic heading",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.heading
          ),
          borderWidth: 2,
          borderColor: "#f58518",
          pointRadius: 0.2,
          spanGaps: true,
          yAxisID: "bearing"
        },
        {
          label: "Roll angle",
          data: toSeries(
            data,
            item => item.timestamp,
            item => item.roll
          ),
          showLine: false,
          borderWidth: 0.5,
          borderColor: "#54a24b",
          backgroundColor: "#54a24b",
          pointRadius: 1.2,
          yAxisID: "roll"
        }
      ]
    };
  }
};

const getChartOptions = (id: string): ChartOptions<"line"> => {
  const metric = getSelectedMetric(id);
  const traj = aircraftStore.selected.get(id)?.trajectory || [];
  const data = getMetricData(traj, metric);
  const { min, max } = getTimestampDomain(data);
  const xScale = {
    ...X_SCALE,
    ...(min != null && max != null ? { min, max } : {})
  };
  const tooltip = {
    ...PLUGINS.tooltip,
    callbacks: {
      title: (items: TooltipItem<"line">[]) => {
        if (items.length === 0) return "";
        const x = items[0].parsed.x;
        return x == null ? "" : formatZuluTimestamp(x);
      },
      ...(metric === "vertical_rate" || metric === "track"
        ? {
            label: (item: TooltipItem<"line">) => {
              const y = item.parsed.y;
              return y == null ? "" : `${item.dataset.label}: ${y}`;
            }
          }
        : {})
    }
  };

  if (metric === "altitude") {
    return {
      plugins: { ...PLUGINS, tooltip },
      animation: false,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        y: {
          border: { width: 0 },
          min: 0,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false }
        },
        x: xScale
      },
      responsive: true,
      maintainAspectRatio: false
    };
  } else if (metric === "speed") {
    return {
      plugins: { ...PLUGINS, tooltip },
      animation: false,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: xScale,
        kts: {
          type: "linear",
          display: true,
          position: "left",
          min: 0,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false }
        },
        mach: {
          type: "linear",
          display: true,
          position: "right",
          min: 0,
          max: 1,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { drawOnChartArea: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    };
  } else if (metric === "vertical_rate") {
    return {
      plugins: { ...PLUGINS, legend: { display: false }, tooltip },
      animation: false,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: xScale,
        y: {
          border: { width: 0 },
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    };
  } else {
    // track
    return {
      plugins: { ...PLUGINS, tooltip },
      animation: false,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: xScale,
        bearing: {
          type: "linear",
          display: true,
          position: "left",
          min: 0,
          max: 360,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false }
        },
        roll: {
          type: "linear",
          display: true,
          position: "right",
          ticks: { font: { family: "B612", size: 9 } },
          grid: { drawOnChartArea: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    };
  }
};

watch(
  () => aircraftList.value.length,
  (newLen, oldLen) => {
    if (oldLen === 1 && newLen === 2) {
      expandedIds.clear();
    }
  }
);
</script>

<style scoped>
.aircraft-list {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 150px);
  overflow-y: auto;
}

.list-item {
  border-bottom: 1px solid #eee;
  cursor: pointer;
  background-color: white;
}

.list-item:hover .header {
  background-color: #f5f5f5;
}

.header {
  padding: 4px 8px;
}

.expanded .header {
  border-bottom: 1px solid #eee;
  background-color: #f0f7ff;
}

.details-body {
  padding: 10px;
  cursor: default;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  line-height: 1.4;
}

.main-row {
  margin-bottom: 2px;
}

.left-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.right-group {
  text-align: right;
  display: flex;
  gap: 4px;
  font-family: "B612", monospace;
  font-size: 0.9em;
  color: #333;
}

.callsign {
  font-size: 1.2em;
  font-weight: normal;
}

.no-data {
  color: #888;
  font-style: italic;
  font-size: 1em;
}

.registration {
  font-size: 0.9em;
  color: #666;
}

.chip {
  border-radius: 5px;
  padding: 0px 5px;
  font-family: "Inconsolata", monospace;
  font-size: 1em;
}

.chip.blue {
  background-color: #4c78a8;
  color: white;
  border: 1px solid #4c78a8;
}

.chip.yellow {
  background-color: #f2cf5b;
  color: black;
  border: 1px solid #e0c050;
}

.icao24::before {
  content: "0x";
  color: #79706e;
  font-size: 95%;
}

.sub-row .right-group {
  color: #666;
}

.sep {
  color: #aaa;
  font-weight: normal;
}

.chart-container {
  background: white;
  height: 180px;
  width: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
}

.plot-select {
  margin-bottom: 10px;
  font-family: "Roboto Condensed", sans-serif;
  font-size: 10pt;
}

.chart-container .chart {
  width: 100%;
  flex: 1;
  height: 200px;
}

.no-data-msg {
  text-align: center;
  color: #888;
  font-style: italic;
  padding: 10px;
}
</style>
