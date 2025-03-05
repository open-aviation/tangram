<template>
  <div @click.stop="onClick" class="chart-container" v-if="defaultData.length > 0">
    <select id="plot-select" @change="onSelectOption" v-model="selectedItem">
      <option value="altitude">Altitude (in ft)</option>
      <option value="speed">Speed (in kts)</option>
      <option value="vertical_rate">Vertical rate (in ft/mn)</option>
      <option value="track">Directions</option>
    </select>
    <LineChart ref="chart"  class="chart" :data="chartData" :options="option" />
  </div>
</template>

<script>
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import { Line as LineChart } from 'vue-chartjs'
import dayjs from 'dayjs'
import { useMapStore} from '../store'

const plugin = {
  id: 'corsair',
  defaults: {
    width: 1,
    color: '#FF4949',
    dash: [3, 3],
  },
  afterInit: (chart, args, opts) => {
    chart.corsair = { x: 0, y: 0 }
  },
  afterEvent: (chart, args) => {
    const {inChartArea} = args
    const {type,x,y} = args.event
    chart.corsair = {x, y, draw: inChartArea}
    chart.draw()
  },
  beforeDatasetsDraw: (chart, args, opts) => {
    const {ctx} = chart
    const {top, bottom, left, right} = chart.chartArea
    const {x, y, draw} = chart.corsair
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
      handler(newValue, oldValue) {
        console.dir('chart type updated: ', newValue);
        if(newValue && newValue.icao24) {
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
      const interval_ms = 1000 * 1; 
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
      const label = evt.chart.data.labels[index]
      const value = evt.chart.data.datasets[0].data[index]
      this.store.setHoverItem(value)
    },

    onClick() {
      console.log('prevent the click event')
    },

    onSelectOption(e) {
      switch(e.target.value) {
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

    updateSpeedChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.option = null;
        this.chartData = {
          labels: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#0000bb30',
                below: '#ffffff30'
              },
              label: 'IAS',
              backgroundColor: 'blue',
              data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.IAS)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#bb000030',
                below: '#ffffff30'
              },
              label: 'TAS',
              backgroundColor: 'red',
              data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.TAS)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#00bb0030',
                below: '#ffffff30'
              },
              label: 'groundspeed',
              backgroundColor: 'green',
              data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.groundspeed)
            }
          ]
        }
      }
    },

    updateVerticalRateChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.option = null;
        this.chartData = {
          labels: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#0000bb30',
                below: '#ffffff30'
              },
              label: 'vrate_barometric',
              backgroundColor: 'blue',
              data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vrate_barometric)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#bb000030',
                below: '#ffffff30'
              },
              label: 'vrate_inertial',
              backgroundColor: 'red',
              data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vrate_inertial)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#00bb0030',
                below: '#ffffff30'
              },
              label: 'vertical_rate',
              backgroundColor: 'green',
              data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vertical_rate)
            }
          ]
        }
      }
    },

    updateTrackChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.option = null;
        this.chartData = {
          labels: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#0000bb30',
                below: '#ffffff30'
              },
              label: 'track',
              backgroundColor: 'blue',
              fillColor: "rgba(100,100,255,0.5)",
              strokeColor: "blue",
              data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.track)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#bb000030',
                below: '#ffffff30'
              },
              label: 'heading',
              backgroundColor: 'red',
              data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.heading)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#00bb0030',
                below: '#ffffff30'
              },
              label: 'roll',
              backgroundColor: 'green',
              data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.roll)
            }
          ]
        }
      }
    },

    updateAltitudeChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.chartData = {
          labels: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 2,
              label: 'altitude',
              radius: 0,
              fill: {
                target: 'origin',
                above: '#80808030',
                below: '#ffffff30'
              },
              tension: 0.25,
              backgroundColor: '#80800',
              borderColor: ["#808080"],
              data: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => item.altitude)
            },
            {
              borderWidth: 2,
              pointRadius: 0.2,
              fill: {
                target: 'origin',
                above: '#0000bb30',
                below: '#ffffff30'
              },
              label: 'selected_altitude',
              borderColor: ["#0000bb"],
              backgroundColor: '#0000bb',
              data: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => item.selected_altitude)
            }
          ]
        }

        this.configureAltitudeChartOptions();
      }
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
        legend: { display: false },
        scales: {
          y: {
            border: { width: 0 },
            max: 40000,
            grid: { display: false, drawBorder: false }
          },
          x: {
            border: { width: 0 },
            grid: { display: false, drawBorder: false }
          }
        },
        plugins: {
          tooltip: { backgroundColor: "#227799", mode: 'nearest', intersect: false },
          filler: { propagate: true },
          corsair: { color: 'black' }
        }
      };
    },

    fetchChartData(item) {
      const {icao24} = item;
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

            const e = {target: {value: this.selectedItem}};
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
<style>
.chart-container {
  position: absolute;
  right: 0;
  z-index: 999;
  background: white;
  height: 250px;
  width: 450px;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
}
#plot-select {
  margin-bottom: 10px;
}
.chart-container .chart {
  width: 100%;
  flex: 1;
  height: 200px;
}
</style>
