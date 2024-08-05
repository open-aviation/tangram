<template>
  <l-polyline :lat-lngs="polyline" :color="color"></l-polyline>
</template>
<script>
import "leaflet/dist/leaflet.css";
import {LPolyline} from '@vue-leaflet/vue-leaflet';
import store from '../store'
export default {
  components: {
    LPolyline
  },
  data() {
    return {
      staticAnchor: [16, 37],
      color: 'black',
      polyline: []
    }
  },
  computed: {
    selected() {
      return store.state.selectedPlane
    },
  },
  watch: {
    selected: function (newVal) {
      if(newVal) {
        this.joinTrajectoryChannel(`channel:trajectory:${newVal.icao24}`)
      }
    }
  },
  methods: {
    joinTrajectoryChannel(channelName) {
      let trajectoryChannel = store.state.socket.channel(channelName, { token: 'okToJoin' }); // no joining token required
      trajectoryChannel.on('new-data', (data) => {
        this.polyline = data
      });

      trajectoryChannel
          .join()
          .receive("ok", ({ messages }) => {
            console.log(`(${channelName}) joined`, messages);
          })
          .receive("error", ({ reason }) =>
              console.log(`failed to join ${channelName}`, reason)
          )
          .receive("timeout", () => console.log(`timeout joining ${channelName}`));
    },
  }
}
</script>
<style>
.tooltip {
  border-radius: 10px;
}
</style>
