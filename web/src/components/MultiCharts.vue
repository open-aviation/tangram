<template>

  <h5>Flight data</h5>
  <div @click.stop="onClick" v-if="defaultData.length > 0">
    <select id="plot-select" @change="onSelectOption" v-model="selectedItem">
      <option value="altitude">Altitude (in ft)</option>
      <option value="speed">Speed (in kts)</option>
      <option value="vertical_rate">Vertical rate (in ft/mn)</option>
      <option value="track">Directions</option>
    </select>
    <div class="chart-container" v-if="defaultData.length > 0">
      <LineChart ref="chart" class="chart" :data="chartData"
        :options="option" />
    </div>
  </div>
</template>

<script>
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import { Line as LineChart } from 'vue-chartjs'
import dayjs from 'dayjs'
import { useMapStore } from '../store'

// ASK: What is this corsair doing?
const plugin = {
  id: 'corsair',
  defaults: {
    width: 1,
    color: '#FF4949',
    dash: [3, 3],
  },
  afterInit: (chart) => {
    chart.corsair = { x: 0, y: 0 }
  },
  afterEvent: (chart, args) => {
    const { inChartArea } = args
    const { x, y } = args.event
    chart.corsair = { x, y, draw: inChartArea }
    chart.draw()
  },
  beforeDatasetsDraw: (chart, _args, opts) => {
    const { ctx } = chart
    const { top, bottom, left, right } = chart.chartArea
    const { x, y, draw } = chart.corsair
    if (!draw) return

    ctx.save()

    ctx.beginPath()
    ctx.lineWidth = opts.width
    ctx.strokeStyle = opts.color
    ctx.setLineDash(opts.dash)
    ctx.moveTo(x, bottom)
    ctx.lineTo(x, top)
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()

    ctx.restore()
  }
}
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  plugin
)

const PLUGINS = {
  tooltip: { backgroundColor: "#bab0ac", mode: 'nearest', intersect: false },
  filler: { propagate: true },
  corsair: { color: 'black' },
  legend: {
    display: true,
    position: 'top',
    labels: {
      font: { family: "B612", size: 10 },
      usePointStyle: true,
      pointStyle: 'line',
    }
  }
}

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
}

export default {
  components: {
    LineChart
  },
  data() {
    return {
      store: useMapStore(),
      selectedItem: 'altitude',
      chartData: {},
      defaultData: [],
      option: null,
      pollInterval: null, // Add polling interval reference
    }
  },
  computed: {
    selected() {
      return this.store.selectedPlane
    }
  },
  mounted() {
    // Start polling when component is mounted
    this.startPolling();
  },
  beforeUnmount() {
    // Clean up interval when component is destroyed
    this.stopPolling();
  },
  watch: {
    selected: {
      deep: true,
      handler(newValue) {
        console.dir('chart type updated: ', newValue);
        if (newValue && newValue.icao24) {
          // Initial fetch when selection changes
          this.fetchChartData(newValue);
        } else {
          this.defaultData = [];
          this.chartData = {};
        }
      }
    }
  },
  methods: {
    startPolling() {
      // Clear any existing interval
      this.stopPolling();

      // Set up new polling interval (every 5 seconds)
      const interval_ms = 1000 * 5;
      this.pollInterval = setInterval(() => {
        if (this.selected && this.selected.icao24) {
          this.fetchChartData(this.selected);
        }
      }, interval_ms);
    },

    stopPolling() {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
    },

    handleChartClick(evt, item) {
      if (!item) return; // Add check to prevent error when item is undefined
      const index = item.index
      const value = evt.chart.data.datasets[0].data[index]
      this.store.setHoverItem(value)
    },

    onClick() {
      console.log('prevent the click event')
    },

    onSelectOption(e) {
      switch (e.target.value) {
        case 'altitude':
          this.updateAltitudeChart();
          break;
        case 'speed':
          this.updateSpeedChart();
          break;
        case 'vertical_rate':
          this.updateVerticalRateChart();
          break;
        case 'track':
          this.updateTrackChart();
          break;
        default:
          this.updateAltitudeChart();
      }
    },


    updateAltitudeChart() {
      if (this.defaultData && this.defaultData.length > 0) {
        var data = this.defaultData.filter(item => ((item.df === 17 && item.altitude) || item.selected_altitude));

        this.chartData = {
          labels: data.map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              label: 'Barometric altitude',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'altitude'
              },
              borderColor: '#4c78a8',
              backgroundColor: '#9ecae9',
              borderWidth: 2,
              radius: 0,
              spanGaps: true,
              order: 2,
              fill: { target: 'origin' },
            },
            {
              label: 'Selected altitude',
              borderColor: "#f58518",
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'selected_altitude'
              },
              borderWidth: 3,
              spanGaps: true,
              pointRadius: 0.2,
              order: 1,
            }
          ]
        }
        this.configureAltitudeChartOptions();
      }
    },

    updateSpeedChart() {
      if (this.defaultData && this.defaultData.length > 0) {
        const data = this.defaultData.filter(item => ((item.df === 17 && item.groundspeed) || item.IAS || item.TAS));
        this.option = null;
        this.chartData = {
          labels: data.map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              label: 'Ground speed',
              data: data.map(item => item.groundspeed),
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'groundspeed'
              },
              borderColor: '#4c78a8',
              borderWidth: 2,
              pointRadius: 0.01,
              spanGaps: true,
              tension: 0.4,
              yAxisID: 'kts',
            },
            {
              label: 'IAS',
              data: data.map(item => item.IAS),
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'IAS'
              },
              borderColor: '#f58518',
              spanGaps: true,
              borderWidth: 2,
              pointRadius: 0.2,
              tension: 0.4,
              yAxisID: 'kts',
            },
            {
              label: 'TAS',
              data: data.map(item => item.TAS),
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'TAS'
              },
              borderColor: '#54a24b',
              spanGaps: true,
              borderWidth: 2,
              pointRadius: 0.2,
              tension: 0.4,
              yAxisID: 'kts',
            },
            {
              label: 'Mach',
              data: data.map(item => item.Mach),
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'Mach'
              },
              borderColor: '#b79a20',
              spanGaps: true,
              borderWidth: 2,
              pointRadius: 0.2,
              tension: 0.4,
              yAxisID: 'mach',
            }
          ],
        }
        this.configureSpeedChartOptions();
      }
    },

    updateVerticalRateChart() {
      if (this.defaultData && this.defaultData.length > 0) {
        const data = this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate));
        this.option = null;
        this.chartData = {
          labels: data.map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              label: 'Vertical rate',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'vertical_rate'
              },
              borderColor: '#4c78a8',
              borderWidth: 1,
              pointRadius: 0.2,
              spanGaps: true,
              tension: 0.4,
            },
            {
              label: 'Barometric',
              type: 'scatter',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'vrate_barometric'
              },
              borderWidth: 0.5,
              pointRadius: 2,
              borderColor: "#f58518",
              backgroundColor: "#f58518",
            },
            {
              label: 'Inertial',
              type: 'scatter',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'vrate_inertial'
              },
              borderWidth: 0.5,
              pointRadius: 2,
              borderColor: "#54a24b",
              backgroundColor: "#54a24b",
            },
          ]
        }
      }
      this.configureVerticalRateChartOptions();
    },

    updateTrackChart() {
      if (this.defaultData && this.defaultData.length > 0) {
        const data = this.defaultData.filter(item => (item.track || item.heading || item.roll));
        this.option = null;
        this.chartData = {
          labels: data.map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              label: "Track",
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'track'
              },
              borderWidth: 2,
              borderColor: '#4c78a8',
              pointRadius: 0.2,
              spanGaps: true,
              yAxisID: 'bearing',
            },
            {
              label: 'Magnetic heading',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'heading'
              },
              borderWidth: 2,
              borderColor: "#f58518",
              pointRadius: 0.2,
              spanGaps: true,
              yAxisID: 'bearing',
            },
            {
              label: 'Roll angle',
              data: data,
              parsing: {
                xAxisKey: 'timestamp',
                yAxisKey: 'roll'
              },
              type: "scatter",
              borderWidth: .5,
              borderColor: '#54a24b',
              backgroundColor: '#54a24b',
              pointRadius: 1.5,
              yAxisID: 'roll',
            }
          ]
        }
      }
      this.configureTrackChartOptions();
    },

    configureAltitudeChartOptions() {
      this.option = {
        onHover: (e) => {
          const chart = this.$refs.chart.chart;
          const item = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false)[0];
          if (item) {
            this.handleChartClick(e, item);
          }
        },
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
    },

    configureSpeedChartOptions() {
      this.option = {
        onHover: (e) => {
          const chart = this.$refs.chart.chart;
          const item = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false)[0];
          if (item) {
            this.handleChartClick(e, item);
          }
        },
        plugins: PLUGINS,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        stacked: false,
        scales: {
          x: X_SCALE,
          kts: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            ticks: { font: { family: "B612", size: 9 } },
            grid: { display: false, drawBorder: false }
          },
          mach: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1,
            ticks: { font: { family: "B612", size: 9 } },
            grid: { drawOnChartArea: false },
          }
        },
        responsive: true,
        maintainAspectRatio: false
      };
    },

    configureVerticalRateChartOptions() {
      this.option = {
        onHover: (e) => {
          const chart = this.$refs.chart.chart;
          const item = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false)[0];
          if (item) {
            this.handleChartClick(e, item);
          }
        },
        plugins: PLUGINS,
        legend: { display: false },
        scales: {
          x: X_SCALE,
          y: {
            border: { width: 0 },
            ticks: { font: { family: "B612", size: 9 } },
            grid: { display: false, drawBorder: false }
          },
        },
        responsive: true,
        maintainAspectRatio: false
      };
    },

    configureTrackChartOptions() {
      this.option = {
        onHover: (e) => {
          const chart = this.$refs.chart.chart;
          const item = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false)[0];
          if (item) {
            this.handleChartClick(e, item);
          }
        },
        plugins: PLUGINS,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        stacked: false,
        scales: {
          x: X_SCALE,
          bearing: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            max: 360,
            ticks: { font: { family: "B612", size: 9 } },
            grid: { display: false, drawBorder: false }
          },
          roll: {
            type: 'linear',
            display: true,
            position: 'right',
            ticks: { font: { family: "B612", size: 9 } },
            grid: { drawOnChartArea: false },
          }
        },
        responsive: true,
        maintainAspectRatio: false
      };
    },

    fetchChartData(item) {
      const { icao24 } = item;
      console.log(`fetching ${icao24} data ...`);
      fetch('/data/' + icao24)
        .then(async (data) => {
          const resp = await data.json();
          console.log(`fetched ${icao24} data ${resp.length} items`);
          return resp;
        })
        .then((ret) => {
          // Only update if this is still the selected plane
          if (this.selected && this.selected.icao24 === icao24) {
            const newValue = ret;
            this.defaultData = newValue;
            this.store.setPlaneData(newValue);

            const e = { target: { value: this.selectedItem } };
            this.onSelectOption(e);
          }
        })
        .catch(error => {
          console.error('Error fetching chart data:', error);
        });
    }
  }
}
</script>
<style scoped>
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
  border-top: solid 1px #bab0ac;
  padding-top: 4px;
  font-size: 97%;
}
</style>
