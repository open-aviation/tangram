<template>
  <div v-if="activeEntity && activeEntity.type === 'jet1090_aircraft'">
    <div v-if="aircraft" id="metadata">
      <span v-if="aircraft.typecode" id="typecode"> {{ aircraft.typecode }}</span>
      <span>{{ aircraft.callsign }}</span>
      <span id="icao24">{{ aircraft.icao24 }}</span
      ><br />
      <span v-if="aircraft.registration" id="registration">
        Registration: {{ flag }} {{ aircraft.registration }} </span
      ><br />
    </div>

    <CityPairWidget />

    <h5>Flight data</h5>
    <div v-if="chartState.trajectoryData.length > 0" @click.stop>
      <select
        id="plot-select"
        v-model="chartState.selectedItem"
        @change="onSelectOption"
      >
        <option value="altitude">Altitude (in ft)</option>
        <option value="speed">Speed (in kts)</option>
        <option value="vertical_rate">Vertical rate (in ft/mn)</option>
        <option value="track">Directions</option>
      </select>
      <div class="chart-container">
        <LineChart
          v-if="chartState.chartData.datasets"
          ref="chart"
          class="chart"
          :data="chartState.chartData"
          :options="chartState.chartOptions"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import type { TangramApi, Entity } from "@open-aviation/tangram/api";
import { aircraft_information } from "rs1090-wasm";
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
  type ChartOptions,
  type ChartData
} from "chart.js";
import { Line as LineChart } from "vue-chartjs";
import dayjs from "dayjs";
import CityPairWidget from "./CityPairWidget.vue";

const corsairPlugin = {
  id: "corsair",
  defaults: {
    width: 1,
    color: "#FF4949",
    dash: [3, 3]
  },
  afterInit: chart => {
    chart.corsair = { x: 0, y: 0 };
  },
  afterEvent: (chart, args) => {
    const { inChartArea } = args;
    const { x, y } = args.event;
    chart.corsair = { x, y, draw: inChartArea };
    chart.draw();
  },
  beforeDatasetsDraw: (chart, _args, opts) => {
    const { ctx } = chart;
    const { top, bottom, left, right } = chart.chartArea;
    if (!chart.corsair) return;
    const { x, y, draw } = chart.corsair;
    if (!draw) return;
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
    position: "top",
    labels: {
      font: { family: "B612", size: 10 },
      usePointStyle: true,
      pointStyle: "line"
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
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}
const activeEntity = tangramApi.state.activeEntity;
const aircraft = computed(() => activeEntity.value?.state as any);
const flag = computed(() => {
  if (!aircraft.value) return "";
  const info = aircraft_information(aircraft.value.icao24, aircraft.value.registration);
  return info?.flag || "";
});

const chartState = reactive({
  selectedItem: "altitude",
  chartData: {} as ChartData<"line">,
  trajectoryData: [] as any[],
  chartOptions: {} as ChartOptions<"line">,
  pollInterval: null as number | null
});

const fetchChartData = async (entity: Entity) => {
  try {
    const response = await fetch(`/data/${entity.id}`);
    if (!response.ok) throw new Error("Failed to fetch trajectory");
    const data = await response.json();
    if (activeEntity.value?.id === entity.id) {
      chartState.trajectoryData = data;
      updateChart();
    }
  } catch (error) {
    console.error("Error fetching chart data:", error);
  }
};

const startPolling = () => {
  stopPolling();
  chartState.pollInterval = window.setInterval(() => {
    if (activeEntity.value) {
      fetchChartData(activeEntity.value);
    }
  }, 5000);
};

const stopPolling = () => {
  if (chartState.pollInterval) {
    clearInterval(chartState.pollInterval);
    chartState.pollInterval = null;
  }
};

const onSelectOption = (e: Event) => {
  chartState.selectedItem = (e.target as HTMLSelectElement).value;
  updateChart();
};

const updateChart = () => {
  switch (chartState.selectedItem) {
    case "altitude":
      updateAltitudeChart();
      break;
    case "speed":
      updateSpeedChart();
      break;
    case "vertical_rate":
      updateVerticalRateChart();
      break;
    case "track":
      updateTrackChart();
      break;
    default:
      updateAltitudeChart();
  }
};

const updateAltitudeChart = () => {
  const data = chartState.trajectoryData.filter(
    item => item.altitude || item.selected_altitude
  );
  chartState.chartData = {
    labels: data.map(item => dayjs.unix(item.timestamp).format("HH:mm")),
    datasets: [
      {
        label: "Barometric altitude",
        data: data.map(item => item.altitude),
        borderColor: "#4c78a8",
        backgroundColor: "#9ecae9",
        borderWidth: 2,
        radius: 0,
        spanGaps: true,
        fill: { target: "origin" }
      },
      {
        label: "Selected altitude",
        data: data.map(item => item.selected_altitude),
        borderColor: "#f58518",
        borderWidth: 3,
        spanGaps: true,
        pointRadius: 0.2
      }
    ]
  };
  chartState.chartOptions = {
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
};

const updateSpeedChart = () => {
  const data = chartState.trajectoryData.filter(
    item => item.groundspeed || item.IAS || item.TAS || item.Mach
  );
  chartState.chartData = {
    labels: data.map(item => dayjs.unix(item.timestamp).format("HH:mm")),
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
        data: data.map(item => item.IAS),
        borderColor: "#f58518",
        spanGaps: true,
        borderWidth: 2,
        pointRadius: 0.2,
        tension: 0.4,
        yAxisID: "kts"
      },
      {
        label: "TAS",
        data: data.map(item => item.TAS),
        borderColor: "#54a24b",
        spanGaps: true,
        borderWidth: 2,
        pointRadius: 0.2,
        tension: 0.4,
        yAxisID: "kts"
      },
      {
        label: "Mach",
        data: data.map(item => item.Mach),
        borderColor: "#b79a20",
        spanGaps: true,
        borderWidth: 2,
        pointRadius: 0.2,
        tension: 0.4,
        yAxisID: "mach"
      }
    ]
  };
  chartState.chartOptions = {
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
};

const updateVerticalRateChart = () => {
  const data = chartState.trajectoryData.filter(
    item => item.vrate_barometric || item.vrate_inertial || item.vertical_rate
  );
  chartState.chartData = {
    labels: data.map(item => dayjs.unix(item.timestamp).format("HH:mm")),
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
  chartState.chartOptions = {
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
};

const updateTrackChart = () => {
  const data = chartState.trajectoryData.filter(
    item => item.track || item.heading || item.roll
  );
  chartState.chartData = {
    labels: data.map(item => dayjs.unix(item.timestamp).format("HH:mm")),
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
  chartState.chartOptions = {
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
};

watch(
  () => activeEntity.value?.id,
  newId => {
    chartState.trajectoryData = [];
    chartState.chartData = {};
    if (newId && activeEntity.value) {
      fetchChartData(activeEntity.value);
    }
  },
  { immediate: true }
);

onMounted(startPolling);
onBeforeUnmount(stopPolling);
</script>

<style scoped>
#metadata {
  margin-bottom: 10px;
}
#registration {
  font-size: 10pt;
}
#icao24 {
  font-family: "Inconsolata", monospace;
  float: right;
  margin-right: 3px;
  border: 1px solid #f2cf5b;
  border-radius: 5px;
  background-color: #f2cf5b;
  padding: 2px 5px;
  font-size: 10pt;
}
#icao24::before {
  content: "0x";
  color: #79706e;
  font-size: 95%;
}
#typecode {
  border: 1px solid #4c78a8;
  background-color: #4c78a8;
  color: white;
  border-radius: 5px;
  padding: 2px 5px;
  font-family: "Roboto Condensed", sans-serif;
  font-size: 10pt;
  float: right;
}

.chart-container {
  background: white;
  height: 180px;
  width: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
}
#plot-select {
  margin-bottom: 10px;
  font-family: "Roboto Condensed", sans-serif;
  font-size: 10pt;
}
.chart-container .chart {
  width: 100%;
  flex: 1;
  height: 200px;
}
h5 {
  margin: 0.5rem 0 1rem 0;
  padding-top: 0.25rem;
  border-top: solid 1px #bab0ac;
  font-family: "Roboto Condensed", sans-serif;
  font-weight: 500;
  font-size: 1.3rem;
}
</style>
