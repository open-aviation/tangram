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
            {{ aircraft_information(item.state.icao24, item.state.registration)?.flag || "" }}
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
  type ChartOptions
} from "chart.js";
import { aircraft_information } from "rs1090-wasm";
import { Line as LineChart } from "vue-chartjs";
import dayjs from "dayjs";
import CityPairWidget from "./CityPairWidget.vue";

const corsairPlugin = {
  id: "corsair",
  defaults: { width: 1, color: "#FF4949", dash: [3, 3] },
  afterInit: (chart: any) => {
    chart.corsair = { x: 0, y: 0 };
  },
  afterEvent: (chart: any, args: any) => {
    const { inChartArea } = args;
    const { x, y } = args.event;
    chart.corsair = { x, y, draw: inChartArea };
    chart.draw();
  },
  beforeDatasetsDraw: (chart: any, _args: any, opts: any) => {
    const { ctx } = chart;
    const { top, bottom, left, right } = chart.chartArea;
    if (!chart.corsair || !chart.corsair.draw) return;
    const { x, y } = chart.corsair;
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
  corsairPlugin
);

const PLUGINS = {
  tooltip: { backgroundColor: "#bab0ac", mode: "nearest", intersect: false },
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
  ticks: {
    font: { family: "B612", size: 9 },
    autoSkip: true,
    maxTicksLimit: 7,
    maxRotation: 0,
    minRotation: 0,
    padding: 5
  },
  border: { width: 0 },
  grid: { display: true, drawBorder: false }
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

const getChartData = (id: string): ChartData<"line"> => {
  const traj = aircraftStore.selected.get(id)?.trajectory || [];
  const metric = getSelectedMetric(id);

  if (metric === "altitude") {
    const data = traj.filter(item => item.altitude || item.selected_altitude);
    return {
      labels: data.map(item => dayjs.unix(item.timestamp!).format("HH:mm")),
      datasets: [
        {
          label: "Barometric altitude",
          data: data.map(item => item.altitude),
          borderColor: "#4c78a8",
          backgroundColor: "#9ecae9",
          borderWidth: 2,
          order: 2,
          radius: 0,
          spanGaps: true,
          fill: { target: "origin" }
        },
        {
          label: "Selected altitude",
          data: data.map(item => item.selected_altitude),
          borderColor: "#f58518",
          borderWidth: 3,
          order: 1,
          spanGaps: true,
          pointRadius: 0.2
        }
      ]
    };
  } else if (metric === "speed") {
    const data = traj.filter(
      item => item.groundspeed || item.ias || item.tas || item.mach
    );
    return {
      labels: data.map(item => dayjs.unix(item.timestamp!).format("HH:mm")),
      datasets: [
        {
          label: "Ground speed",
          data: data.map(item => item.groundspeed),
          borderColor: "#4c78a8",
          borderWidth: 2,
          pointRadius: 0.01,
          spanGaps: true,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "IAS",
          data: data.map(item => item.ias),
          borderColor: "#f58518",
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 0.2,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "TAS",
          data: data.map(item => item.tas),
          borderColor: "#54a24b",
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 0.2,
          tension: 0.4,
          yAxisID: "kts"
        },
        {
          label: "Mach",
          data: data.map(item => item.mach),
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
    const data = traj.filter(
      item => item.vrate_barometric || item.vrate_inertial || item.vertical_rate
    );
    return {
      labels: data.map(item => dayjs.unix(item.timestamp!).format("HH:mm")),
      datasets: [
        {
          label: "Vertical rate",
          data: data.map(item => item.vertical_rate),
          borderColor: "#4c78a8",
          borderWidth: 1,
          pointRadius: 0.2,
          spanGaps: true,
          tension: 0.4
        },
        {
          label: "Barometric",
          type: "scatter",
          data: data.map(item => item.vrate_barometric),
          borderWidth: 0.5,
          pointRadius: 2,
          borderColor: "#f58518",
          backgroundColor: "#f58518"
        },
        {
          label: "Inertial",
          type: "scatter",
          data: data.map(item => item.vrate_inertial),
          borderWidth: 0.5,
          pointRadius: 2,
          borderColor: "#54a24b",
          backgroundColor: "#54a24b"
        }
      ]
    };
  } else {
    // track
    const data = traj.filter(item => item.track || item.heading || item.roll);
    return {
      labels: data.map(item => dayjs.unix(item.timestamp!).format("HH:mm")),
      datasets: [
        {
          label: "Track",
          data: data.map(item => item.track),
          borderWidth: 2,
          borderColor: "#4c78a8",
          pointRadius: 0.2,
          spanGaps: true,
          yAxisID: "bearing"
        },
        {
          label: "Magnetic heading",
          data: data.map(item => item.heading),
          borderWidth: 2,
          borderColor: "#f58518",
          pointRadius: 0.2,
          spanGaps: true,
          yAxisID: "bearing"
        },
        {
          label: "Roll angle",
          data: data.map(item => item.roll),
          type: "scatter",
          borderWidth: 0.5,
          borderColor: "#54a24b",
          backgroundColor: "#54a24b",
          pointRadius: 1.5,
          yAxisID: "roll"
        }
      ]
    };
  }
};

const getChartOptions = (id: string): ChartOptions<"line"> => {
  const metric = getSelectedMetric(id);
  if (metric === "altitude") {
    return {
      plugins: PLUGINS,
      scales: {
        y: {
          border: { width: 0 },
          min: 0,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false, drawBorder: false }
        },
        x: X_SCALE
      },
      responsive: true,
      maintainAspectRatio: false
    };
  } else if (metric === "speed") {
    return {
      plugins: PLUGINS,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: X_SCALE,
        kts: {
          type: "linear",
          display: true,
          position: "left",
          min: 0,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false, drawBorder: false }
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
      plugins: { ...PLUGINS, legend: { display: false } },
      scales: {
        x: X_SCALE,
        y: {
          border: { width: 0 },
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false, drawBorder: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    };
  } else {
    // track
    return {
      plugins: PLUGINS,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: X_SCALE,
        bearing: {
          type: "linear",
          display: true,
          position: "left",
          min: 0,
          max: 360,
          ticks: { font: { family: "B612", size: 9 } },
          grid: { display: false, drawBorder: false }
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
