<template>
  <div class="main-container" :class="{'hasItem': selected}">
    <TopNavBar :updateItem="updateItem" />
    <LeftSideBar :selected="selected" :updateItem="updateItem" />
    <l-map @click="emptySelect" class="map-container" ref="map" v-model:zoom="zoom" :center="[47.41322, -1.219482]" >
      <l-tile-layer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          layer-type="base"
          name="OpenStreetMap"
      ></l-tile-layer>
      <PlaneData ref="planes" @onSelectPlane="onSelectPlane" :planeData="planes" />
      <Polyline :polyline="polyline" />
    </l-map>
  </div>

</template>

<script>
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer } from "@vue-leaflet/vue-leaflet";
import { Socket } from "phoenix"
import TopNavBar from "./components/TopNavBar.vue"
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/Plane.vue";
import Polyline from "./components/Polyline.vue";
export default {
  components: {
    Polyline,
    LeftSideBar,
    LMap,
    LTileLayer,
    TopNavBar,
    PlaneData
  },
  data() {
    return {
      zoom: 5,
      Phoenix: null,
      clock: null,
      updateItem: null,
      planes: [],
      selected: null,
      socket: null,
      polyline: [],
      chartData: [],
      columns: []
    };
  },
  mounted() {
    const userToken = "joining-token";
    const debug = false
    this.socket = new Socket("", { debug, params: { userToken } });
    this.socket.connect();
    const systemChannelName = "channel:system";
    const systemChannelToken = "channel-token";
    let systemChannel = this.socket.channel(systemChannelName, { token: systemChannelToken });
    systemChannel.on('update-node', ({ el, html }) => {
      this.updateItem = {el, html}
    });
    systemChannel
        .join()
        .receive("ok", ({ messages }) => {
          console.log(`(${systemChannelName}) joined`, messages);
        })
        .receive("error", ({ reason }) =>
            console.log(`failed to join ${systemChannelName}`, reason)
        )
        .receive("timeout", () => console.log(`timeout joining ${systemChannelName}`));
    // plane
    const streamingChannelName = "channel:streaming";
    const streamingChannelToken = "channel-token";
    let streamingChannel = this.socket.channel(streamingChannelName, { token: streamingChannelToken });
    streamingChannel.on("new-data", data => {
      if(data && data.length > 0) {
        this.planes = data.filter(item => item.latitude && item.longitude)
      }
    });

    streamingChannel
        .join()
        .receive("ok", ({ messages }) => {
          console.log(`(${streamingChannelName}) joined`, messages);
        })
        .receive("error", ({ reason }) =>
            console.log(`failed to join ${streamingChannelName}`, reason)
        )
        .receive("timeout", () => console.log(`timeout joining ${streamingChannelName}`));


  },
  methods: {
    joinTrajectoryChannel(channelName) {
      let trajectoryChannel = this.socket.channel(channelName, { token: 'okToJoin' }); // no joining token required
      trajectoryChannel.on('new-data', (data) => {
        this.polyline = data
      });

      trajectoryChannel
          .join()
          .receive("ok", ({ messages }) => {
            trajectoryPlots = [];
            console.log(`(${channelName}) joined`, messages);
          })
          .receive("error", ({ reason }) =>
              console.log(`failed to join ${channelName}`, reason)
          )
          .receive("timeout", () => console.log(`timeout joining ${channelName}`));
    },
    emptySelect() {
      this.selected = null
      this.$refs.planes.selected = null
    },
    async onSelectPlane(item) {
      this.selected = item
      this.joinTrajectoryChannel(`channel:trajectory:${this.selected.icao24}`)
      const res = await fetch('/data/' + item.icao24)
      const jsonRes = res.json()
      if(jsonRes && jsonRes.length > 0) {
        this.columns = ["groundspeed", "IAS", "TAS"]
        this.chartData = jsonRes
      }
    }
  }
};
</script>
<style>
html {
  width: 100%;
  height: 100%;
}
body {
  font-family: "B612", sans-serif;
  width: 100%;
  height: 100%;
}
.main-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}
@media (min-width: 768px) {
  .leaflet-control-container .leaflet-left {
    transition: left 80ms;
  }
}

@media (min-width: 768px) and (max-width: 1199px) {
  .hasItem .leaflet-control-container .leaflet-left {
    left: 315px;
  }
}

@media (min-width: 1200px) {
  .hasItem .leaflet-control-container .leaflet-left {
    left: 305px;
  }
}

.leaflet-control-container .leaflet-left {
  left: 50px;
}

.main-container .map-container {
  flex: 1;
  flex-grow: 1;
}
.aircraft_img {
  fill: #f9fd15;
}

.aircraft_selected {
  fill: green;
}
</style>
