<template>
  <div @click.stop="onClick" class="chart-container" v-if="defaultData.length > 0">
    <select id="plot-select" @change="onSelectOption" v-model="selectedItem">
      <option value="altitude">Altitude (in ft)</option>
      <option value="speed">Speed (in kts)</option>
      <option value="vertical_rate">Vertical rate (in ft/mn)</option>
      <option value="track">Directions</option>
    </select>
    <Line class="chart" :data="chartData"  />
  </div>
</template>
<script>
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Line } from 'vue-chartjs'
import dayjs from 'dayjs'

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
)

export default {
  components: {
    Line
  },
  props: ['selected'],
  data() {
    return {
      selectedItem: 'altitude',
      chartData: {},
      defaultData: []
    }
  },
  mounted() {
    window.dayjs = dayjs
  },
  watch: {
    selected: {
      deep: true,
      handler(newValue) {
        if(newValue && newValue.icao24) {
          this.fetchChartData(newValue)
        } else {
          this.defaultData = []
          this.chartData = {}
        }
      }
    }
  },
  methods: {
    onClick() {
    },
    onSelectOption(e) {
      switch(e.target.value) {
        case 'speed':
          if(this.defaultData && this.defaultData.length > 0) {
            this.chartData = {
              labels: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
              datasets: [
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'IAS',
                  backgroundColor: 'blue',
                  data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.IAS)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'TAS',
                  backgroundColor: 'red',
                  data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.TAS)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'groundspeed',
                  backgroundColor: 'green',
                  data: this.defaultData.filter(item => (item.groundspeed || item.IAS || item.TAS)).map(item => item.groundspeed)
                }
              ]
            }
          }
          break;
        case 'vertical_rate':
          if(this.defaultData && this.defaultData.length > 0) {
            this.chartData = {
              labels: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
              datasets: [
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'vrate_barometric',
                  backgroundColor: 'blue',
                  data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vrate_barometric)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'vrate_inertial',
                  backgroundColor: 'red',
                  data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vrate_inertial)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'vertical_rate',
                  backgroundColor: 'green',
                  data: this.defaultData.filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate)).map(item => item.vertical_rate)
                }
              ]
            }
          }
          break;
        case 'track':
          if(this.defaultData && this.defaultData.length > 0) {
            this.chartData = {
              labels: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
              datasets: [
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'track',
                  backgroundColor: 'blue',
                  data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.track)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'heading',
                  backgroundColor: 'red',
                  data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.heading)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'roll',
                  backgroundColor: 'green',
                  data: this.defaultData.filter(item => (item.track || item.heading || item.roll)).map(item => item.roll)
                }
              ]
            }
          }
          break;
        default:
          if(this.defaultData && this.defaultData.length > 0) {
            this.chartData = {
              labels: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
              datasets: [
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'altitude',
                  backgroundColor: '#f87979',
                  data: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => item.altitude)
                },
                {
                  borderWidth: 1,
                  pointRadius: 0.2,
                  fill: false,
                  label: 'selected_altitude',
                  backgroundColor: 'blue',
                  data: this.defaultData.filter(item => (item.altitude || item.selected_altitude)).map(item => item.selected_altitude)
                }
              ]
            }
          }
      }
    },
    fetchChartData(item) {
      fetch('/data/' + item.icao24).then((data) => {
        return data.json();
      }).then((ret) => {
        const newValue = ret
        this.defaultData = newValue
        const e = {target: {value: this.selectedItem}}
        this.onSelectOption(e)
      })
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
