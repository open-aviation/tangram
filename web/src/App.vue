<template>
  <div class="main-container" :class="{'hasItem': show}">
    <TopNavBar />
    <LeftSideBar ref="leftBar" />
    <l-map @click="emptySelect" @mousemove="getPosition($event)"  class="map-container" ref="map" v-model:zoom="zoom" :center="[47.41322, -1.219482]" >
      <l-tile-layer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          layer-type="base"
          name="OpenStreetMap"
      ></l-tile-layer>
      <PlaneData />
      <PolyLines />
      <Charts v-show="show"  />
<!--      <LatLngBar :position="position" />-->
      <HoverDisplay />
    </l-map>
  </div>

</template>

<script>
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer } from "@vue-leaflet/vue-leaflet";
import { Socket } from "phoenix"
import TopNavBar from "./components/TopNavBar.vue"
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/AirPlane.vue";
import PolyLines from "./components/PlanePolylines.vue";
import Charts from "./components/MultiCharts.vue";
import store from './store'
import LatLngBar from "./components/LatLngBar.vue";
import HoverDisplay from "./components/HoverDisplay.vue";

export default {
  components: {
    HoverDisplay,
    LatLngBar,
    PolyLines,
    LeftSideBar,
    LMap,
    LTileLayer,
    TopNavBar,
    PlaneData,
    Charts
  },
  data() {
    return {
      zoom: 5,
      position: ''
    };
  },
  computed: {
    show() {
      return store.state.showDrawer
    }
  },
  mounted() {
    const userToken = "joining-token";
    const debug = false
    const socket = new Socket("", { debug, params: { userToken } });
    socket.connect();
    store.commit('setSocket', socket)
    const systemChannelName = "channel:system";
    const systemChannelToken = "channel-token";
    let systemChannel = socket.channel(systemChannelName, { token: systemChannelToken });
    systemChannel.on('update-node', ({ el, html }) => {
      this.updateItem = {el, html}
      if(el === 'plane_count') {
        store.commit('setCount', html)
      }
      if(el === 'uptime') {
        store.commit('setUpTime', html)
      }
      if(el === 'info_utc') {
        store.commit('setInfo', html)
      }
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
  },

  methods: {
    getPosition(event) {
      this.position = event.latlng.toString()
    },
    emptySelect() {
      store.commit('setShowDrawer', false)
    },
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
.aircraft_img svg {
  fill: #f9fd15;
}

.leaflet-attribution-flag {
  display: none !important;
}

.aircraft_selected svg {
  fill: green;
}
</style>
