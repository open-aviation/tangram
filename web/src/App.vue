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
      <PlaneTrail />

      <plugin-airportsearch />
      <plugin-sensorsinfo />
      <plugin-windfield />

      <!--<plugin-sigmetinfo />
      <plugin-foursensors /> -->


    </l-map>

  </div>
</template>

<script>
import { onBeforeUnmount } from "vue";
import { useMapStore } from "./store";

import { LMap, LTileLayer } from "@vue-leaflet/vue-leaflet";
import "leaflet/dist/leaflet.css";

import TopNavBar from "./components/TopNavBar.vue";
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/AirPlane.vue";
import PlaneTrail from "./components/PlaneTrail.vue";

export default {
  components: {
    PlaneTrail,
    LeftSideBar,
    LMap,
    LTileLayer,
    TopNavBar,
    PlaneData,
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
    const lat = import.meta.env.VITE_LEAFLET_CENTER_LAT || 48;
    const lon = import.meta.env.VITE_LEAFLET_CENTER_LON || 7;
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
    console.log('App mounted');

    // Wait for socket connection first
    while (!this.store.socket) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Access map after it's fully initialized
    this.$nextTick(() => {
      this.store.map = this.$refs.map;
    });

    console.log("joining system channel");
    const channelName = "system";
    const callbacks = {
      "update-node": this.updateNode.bind(this),
    };
    await this.joinChannel(this.store.socket, channelName, callbacks);
  },

  methods: {
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
      const { el, value } = arg;
      if (el === "uptime") {
        this.store.setUpTime(value);
      }
      if (el === "info_utc") {
        this.store.setInfoUtc(value);
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

.leaflet-control-attribution {
  display: none !important;
}

.leaflet-top,
.leaflet-bottom {
  z-index: 400;
}
</style>
