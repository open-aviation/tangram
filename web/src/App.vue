<template>
  <div class="main-container" :class="{ hasItem: show }">
    <TopNavBar />
    <LeftSideBar ref="leftBar" />

    <l-map @click="emptySelect" @mousemove="getPosition($event)"
      @moveend="updateCenter" class="map-container" ref="map"
      v-model:zoom="zoom" :center="center" @update:bounds="updateBounds">

      <l-tile-layer :url="map_url" layer-type="base"
        name="OpenStreetMap"></l-tile-layer>


      <PlaneData />
      <PolyLines />

      <AirportSearch @airport-selected="centerMapTo" />

      <plugin-sensors />
      <plugin-sigmet />

    </l-map>

    <!-- <timeline :styles="{
      width: 'calc(100% - 40px)',
      position: 'absolute',
      bottom: 0,
      zindex: 500,
      left: '40px',
      background: '#ffffff80',
      color: 'black',
    }" /> -->
  </div>
</template>

<script>
import { onBeforeUnmount } from "vue";
import { useMapStore } from "./store";

import { LMap, LTileLayer } from "@vue-leaflet/vue-leaflet";
import "leaflet/dist/leaflet.css";

import AirportSearch from "./components/AirportSearch.vue";
import TopNavBar from "./components/TopNavBar.vue";
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/AirPlane.vue";
import PolyLines from "./components/PlanePolylines.vue";
//import HoverDisplay from "./components/HoverDisplay.vue";
//import Timeline from "./components/Timeline.vue";

export default {
  components: {
    //Timeline,
    //HoverDisplay,
    //LatLngBar,
    PolyLines,
    LeftSideBar,
    LMap,
    LTileLayer,
    TopNavBar,
    PlaneData,
    AirportSearch,
  },

  setup() {
    console.log('app setup ...');
    const mapStore = useMapStore();

    // Initialize socket
    mapStore.createSocket();

    // Clean up when component is unmounted
    onBeforeUnmount(() => {
      mapStore.destroySocket();
    });

    return { mapStore };
  },

  data() {
    const lat = import.meta.env.VITE_LEAFLET_CENTER_LAT || 48.3169;
    const lon = import.meta.env.VITE_LEAFLET_CENTER_LON || 6.9459;
    const zoom = import.meta.env.VITE_LEAFLET_ZOOM || 6;
    const map_url = import.meta.env.VITE_TANGRAM_MAP_URL || "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
    return {
      position: "",
      center: [lat, lon],
      zoom: zoom,
      map_url: map_url,
      store: useMapStore(),
    };
  },

  computed: {
    show() {
      return this.store.showDrawer;
    },
  },

  async mounted() {
    console.log('app mounted');
    // const socket = await this.store.createSocket();
    while (!this.store.socket) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("joining system channel");
    const channelName = "system";
    const callbacks = {
      "update-node": this.updateNode.bind(this),
    };
    await this.joinChannel(this.store.socket, channelName, callbacks);
  },

  methods: {
    centerMapTo(airport) {
      const map = this.$refs.map.leafletObject;
      console.log(airport.icao + "selected", map);
      if (map && airport.lat && airport.lon) {
        map.setView([airport.lat, airport.lon], 13);
      }
    },
    joinChannel(socket, channelName, callbacks) {
      return new Promise((resolve, reject) => {
        console.log(`joining ${channelName} channel ...`);

        let channel = socket.channel(channelName);
        channel.on("update-node", this.updateNode.bind(this));
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
    updateBounds(bounds) {
      this.store.setBounds(bounds);
    },
    updateNode(arg) {
      const { el, html, now } = arg;
      // console.log(`${now} updateNode, `, arg);
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

.leaflet-control-container {
  position: absolute;
  right: 55px;
  bottom: 90px;
}

.main-container .map-container {
  flex: 1;
  flex-grow: 1;
}

.aircraft_img svg {
  fill: #f9fd15;
}

.leaflet-control-attribution {
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
