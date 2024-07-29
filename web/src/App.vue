<template>
  <div class="main-container">
    <TopNavBar :updateItem="updateItem" />
    <LeftSideBar :selected="selected" :updateItem="updateItem" />
    <l-map class="map-container" ref="map" v-model:zoom="zoom" :center="[47.41322, -1.219482]">
      <l-tile-layer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          layer-type="base"
          name="OpenStreetMap"
      ></l-tile-layer>
      <PlaneData @onSelectPlane="onSelectPlane" :planeData="planes" />
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
export default {
  components: {
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
      selected: {}
    };
  },
  mounted() {
    const userToken = "joining-token";
    const debug = false
    let socket = new Socket("", { debug, params: { userToken } });
    socket.connect();
    const systemChannelName = "channel:system";
    const systemChannelToken = "channel-token";
    let systemChannel = socket.channel(systemChannelName, { token: systemChannelToken });
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
    let streamingChannel = socket.channel(streamingChannelName, { token: streamingChannelToken });
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
    onSelectPlane(item){
      this.selected = item
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
