<template>
  <div class="main-container" :class="{ hasItem: show }">
    <TopNavBar />
    <LeftSideBar ref="leftBar" />

    <l-map @click="emptySelect" @mousemove="getPosition($event)" @moveend="updateCenter" class="map-container" ref="map"
      v-model:zoom="zoom" :center="center">

      <l-tile-layer :url="map_url" layer-type="base"
        name="OpenStreetMap"></l-tile-layer>

      <PlaneData />
      <PolyLines />
      <Charts v-show="show" />
      <!-- <LatLngBar :position="position" />-->
      <HoverDisplay />

      <!-- <plugin-sensors /> -->
    </l-map>

    <Timeline :styles="{
      width: 'calc(100% - 40px)',
      position: 'absolute',
      bottom: 0,
      zIndex: 500,
      left: '40px',
      background: '#ffffff80',
      color: 'black',
    }" />
  </div>
</template>

<script>
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer } from "@vue-leaflet/vue-leaflet";
import { Socket } from "phoenix";
import TopNavBar from "./components/TopNavBar.vue";
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/AirPlane.vue";
import PolyLines from "./components/PlanePolylines.vue";
import Charts from "./components/MultiCharts.vue";
import { useMapStore } from "./store";
//import LatLngBar from "./components/LatLngBar.vue";
import HoverDisplay from "./components/HoverDisplay.vue";
import Timeline from "./components/Timeline.vue";
//import Timeline from "./components/Timeline.vue";

export default {
  components: {
    Timeline,
    //Timeline,
    HoverDisplay,
    //LatLngBar,
    PolyLines,
    LeftSideBar,
    LMap,
    LTileLayer,
    TopNavBar,
    PlaneData,
    Charts,
  },
  data() {
    return {
      zoom: 6,
      position: "",
      map_url: import.meta.env.VITE_TANGRAM_MAP_URL || "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      store: useMapStore(),
      center: [48.3169, 6.9459], // Add this line
    };
  },
  computed: {
    show() {
      return this.store.showDrawer;
    },
  },
  async mounted() {
    const socket = await this.store.createSocket();

    console.log("joining system channel");
    const channelName = "system";
    const callbacks = {
      "update-node": this.updateNode.bind(this),
    };
    await this.joinChannel(socket, channelName, callbacks);
  },

  methods: {
    joinChannel(socket, channelName, callbacks) {
      return new Promise((resolve, reject) => {
        console.log(`joining ${channelName} channel ...`);

        let channel = socket.channel(channelName);
        // channel.on("update-node", this.updateNode.bind(this));
        for (let [event, handler] of Object.entries(callbacks)) {
          channel.on(event, handler);
        }
        channel
          .join()
          .receive("ok", ({ messages }) => {
            console.log(`${channelName} / joined`, messages);
            this.store.setSystemChannel(channel);
            resolve(channel);
          })
          .receive("error", ({ reason }) => {
            console.log(`${channelName} / failed to join`, reason);
            reject(reason);
          })
          .receive("timeout", () => {
            console.log(`${channelName} / timeout joining`);
            reject("timeout");
          });
      });
    },
    getPosition(event) {
      this.position = event.latlng.toString();
    },
    emptySelect() {
      this.store.setShowDrawer(false);
    },
    updateCenter(event) {
      this.center = event.target.getCenter();
    },
    updateNode(arg) {
      const { el, html, now } = arg;
      // console.log(`${now} updateNode, `, arg);
      if (el === "plane_count") {
        this.store.setCount(html);
      }
      if (el === "uptime") {
        this.store.setUpTime(html);
      }
      if (el === "info_utc") {
        this.store.setInfoUtc({ html, now });
      }
      if (el === "info_local") {
        this.store.setInfoLocal(html);
      }
    },
  },
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

.leaflet-top,
.leaflet-bottom {
  z-index: 400;
}
</style>
