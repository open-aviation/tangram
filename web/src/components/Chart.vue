<template>
  <div class="chart-container" v-if="chartData.labels">
    <select id="plot-select" @change="onSelectOption">
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
    onSelectOption(e) {
      console.log(e.target.value)
    },
    fetchChartData(item) {
      fetch('/data/' + item.icao24).then((data) => {
        return data.json();
      }).then((ret) => {
        const newValue = ret
        this.defaultData = newValue
        if(newValue && newValue.length > 0) {
          this.chartData = {
            labels: newValue.filter(item => item.altitude).map(item => dayjs.unix(item.timestamp).format('HH:mm')),
            datasets: [
              {
                borderWidth: 1,
                pointRadius: 0.2,
                fill: false,
                label: 'Altitude',
                backgroundColor: '#f87979',
                data: newValue.filter(item => item.altitude).map(item => item.altitude)
              }
            ]
          }
        }
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
