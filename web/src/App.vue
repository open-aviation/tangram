<template>
  <div class="main-container" :class="{ 'hasItem': show }">
    <TopNavBar @changeMap="onMapChanged" />
    <LeftSideBar ref="leftBar" />
    <l-map :max-zoom="23" :min-zoom="2" @click="emptySelect" @mousemove="getPosition($event)" @moveend="updateCenter" class="map-container" ref="map"
      v-model:zoom="zoom" :center="center">
      <l-tile-layer :url="tileUrl" layer-type="base"
        name="OpenStreetMap"></l-tile-layer>
      <PlaneData />
      <PolyLines />
      <Charts v-show="show" />
      <!-- <LatLngBar :position="position" />-->
      <HoverDisplay />
      <l-circle
          :lat-lng="center"
          :radius="radius"
          color="#808080" />
    </l-map>
    <MapCustomStyleModal ref="mapCustomStyleModal" @save="onMapChanged" />
    <Timeline
      :styles="{ width: 'calc(100% - 40px)', position: 'absolute', bottom: 0, zIndex: 500, left: '40px', background: '#ffffff80', color: 'black' }" />

  </div>

</template>

<script>
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer, LCircle } from "@vue-leaflet/vue-leaflet";
import { Socket } from "phoenix"
import TopNavBar from "./components/TopNavBar.vue"
import LeftSideBar from "./components/LeftSideBar.vue";
import PlaneData from "./components/AirPlane.vue";
import PolyLines from "./components/PlanePolylines.vue";
import Charts from "./components/MultiCharts.vue";
import { useMapStore } from './store'
//import LatLngBar from "./components/LatLngBar.vue";
import HoverDisplay from "./components/HoverDisplay.vue";
import Timeline from "./components/Timeline.vue";
//import Timeline from "./components/Timeline.vue";
import mapOptions from "./config/mapTileConfig.js";
import MapCustomStyleModal from "./components/MapCustomStyleModal.vue";


export default {
  components: {
    MapCustomStyleModal,
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
    LCircle
  },
  data() {
    return {
      zoom: 6,
      position: '',
      store: useMapStore(),
      center: [48.3169, 6.9459],  // Add this line
      tileUrl: mapOptions[0].url,
    };
  },
  watch: {
    zoom(val) {
      this.store.setCircleRadius(val)
    },
    center(v) {
      this.store.setMapCenter(v)
    }
  },
  computed: {
    radius() {
      return this.store.circleRadius;
    },
    show() {
      return this.store.showDrawer
    },
    getDefault() {
      return this.store.defaultUrl
    }
  },
  mounted() {
    const userToken = "joining-token";
    const debug = false
    const socket = new Socket("", { debug, params: { userToken } });
    socket.connect();
    this.store.setSocket(socket)

    const systemChannelName = "channel:system";
    const systemChannelToken = "channel-token";
    let systemChannel = socket.channel(systemChannelName, { token: systemChannelToken });
    systemChannel.on('update-node', ({ el, html }) => {
      this.updateItem = { el, html }
      if (el === 'plane_count') {
        this.store.setCount(html)
      }
      if (el === 'uptime') {
        this.store.setUpTime(html)
      }
      if (el === 'info_utc') {
        this.store.setInfoUtc(html)
      }
      if (el === 'info_local') {
        this.store.setInfoLocal(html)
      }
    });
    systemChannel
      .join()
      .receive("ok", ({ messages }) => {
        console.log(`(${systemChannelName}) joined`, messages);
        this.store.setSystemChannel(systemChannel);
      })
      .receive("error", ({ reason }) =>
        console.log(`failed to join ${systemChannelName}`, reason)
      )
      .receive("timeout", () => console.log(`timeout joining ${systemChannelName}`));
  },

  methods: {
    onMapChanged(v) {
      if(v) {
        this.tileUrl = v
      } else {
        this.$refs.mapCustomStyleModal.visible = true
        const d = mapOptions.find(item => item.url === this.getDefault)
        if(!d) {
          this.$refs.mapCustomStyleModal.url = this.getDefault
        }
      }
    },
    getPosition(event) {
      this.position = event.latlng.toString()
    },
    emptySelect() {
      this.store.setShowDrawer(false)
    },
    updateCenter(event) {
      this.center = event.target.getCenter();
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

.leaflet-top,
.leaflet-bottom {
  z-index: 400;
}
</style>
