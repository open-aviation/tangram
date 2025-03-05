<template>
  <div class="chart-container" v-if="defaultData.length > 0">
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
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Line } from 'vue-chartjs'
import dayjs from 'dayjs'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

export default {
  components: { Line },
  props: ['selected'],
  data() {
    return {
      selectedItem: 'altitude',
      chartData: {},
      defaultData: [],
      pollInterval: null // Add polling interval reference
    }
  },
  mounted() {
    window.dayjs = dayjs;
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
        console.dir(`selected: `, newValue)
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
    startPolling() {
      // Clear any existing interval
      this.stopPolling();
      
      // Set up new polling interval (every 5 seconds)
      this.pollInterval = setInterval(() => {
        if (this.selected && this.selected.icao24) {
          this.fetchChartData(this.selected);
        }
      }, 5000); // 5000 ms = 5 seconds
    },
    
    stopPolling() {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
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
        this.chartData = {
          labels: this.defaultData
            .filter(item => (item.groundspeed || item.IAS || item.TAS))
            .map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'IAS',
              backgroundColor: 'blue',
              data: this.defaultData
                .filter(item => (item.groundspeed || item.IAS || item.TAS))
                .map(item => item.IAS)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'TAS',
              backgroundColor: 'red',
              data: this.defaultData
                .filter(item => (item.groundspeed || item.IAS || item.TAS))
                .map(item => item.TAS)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'groundspeed',
              backgroundColor: 'green',
              data: this.defaultData
                .filter(item => (item.groundspeed || item.IAS || item.TAS))
                .map(item => item.groundspeed)
            }
          ]
        }
      }
    },
    
    updateVerticalRateChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.chartData = {
          labels: this.defaultData
            .filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate))
            .map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'vrate_barometric',
              backgroundColor: 'blue',
              data: this.defaultData
                .filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate))
                .map(item => item.vrate_barometric)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'vrate_inertial',
              backgroundColor: 'red',
              data: this.defaultData
                .filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate))
                .map(item => item.vrate_inertial)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'vertical_rate',
              backgroundColor: 'green',
              data: this.defaultData
                .filter(item => (item.vrate_barometric || item.vrate_inertial || item.vertical_rate))
                .map(item => item.vertical_rate)
            }
          ]
        }
      }
    },
    
    updateTrackChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.chartData = {
          labels: this.defaultData
            .filter(item => (item.track || item.heading || item.roll))
            .map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'track',
              backgroundColor: 'blue',
              data: this.defaultData
                .filter(item => (item.track || item.heading || item.roll))
                .map(item => item.track)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'heading',
              backgroundColor: 'red',
              data: this.defaultData
                .filter(item => (item.track || item.heading || item.roll))
                .map(item => item.heading)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'roll',
              backgroundColor: 'green',
              data: this.defaultData
                .filter(item => (item.track || item.heading || item.roll))
                .map(item => item.roll)
            }
          ]
        }
      }
    },
    
    updateAltitudeChart() {
      if(this.defaultData && this.defaultData.length > 0) {
        this.chartData = {
          labels: this.defaultData
            .filter(item => (item.altitude || item.selected_altitude))
            .map(item => dayjs.unix(item.timestamp).format('HH:mm')),
          datasets: [
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'altitude',
              backgroundColor: '#f87979',
              data: this.defaultData
                .filter(item => (item.altitude || item.selected_altitude))
                .map(item => item.altitude)
            },
            {
              borderWidth: 1,
              pointRadius: 0.2,
              fill: false,
              label: 'selected_altitude',
              backgroundColor: 'blue',
              data: this.defaultData
                .filter(item => (item.altitude || item.selected_altitude))
                .map(item => item.selected_altitude)
            }
          ]
        }
      }
    },

    fetchChartData(item) {
      fetch('/data/' + item.icao24)
        .then((data) => {
          return data.json();
        })
        .then((ret) => {
          // Only update if this is still the selected plane
          if (this.selected && this.selected.icao24 === item.icao24) {
            const newValue = ret;
            this.defaultData = newValue;
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
