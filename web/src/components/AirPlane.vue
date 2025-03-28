<template>
  <l-layer-group>
    <v-rotated-marker v-for="(item, index) in planeData" :key="index"
      @click="showRoute" :icon="getIcon(item)" :autofocus="false"
      :rotationAngle="getRotate(item)"
      :lat-lng="[item.latitude, item.longitude]">
      <l-tooltip class="leaflet-tooltip-custom" :id="item.icao24"
        :options="{ direction: 'top', offset: [0, -10] }">
        <AircraftTooltip :aircraft="item" />
      </l-tooltip>
      <l-popup class="popup-leaflet-hidden" :options="{ autoPan: false }">
        <div ref="popup" :id="'popup-' + item.icao24">
          {{ item.icao24 }}
        </div>
      </l-popup>
    </v-rotated-marker>
  </l-layer-group>
</template>
<script>
import L from "leaflet";

import "leaflet/dist/leaflet.css";
//import "vue-leaflet-markercluster/dist/style.css";

import { LLayerGroup, LPopup, LTooltip } from "@vue-leaflet/vue-leaflet";
import { LMarkerRotate } from "vue-leaflet-rotate-marker";
import Raphael from "raphael";

import { get_image_object } from "./PlanePath";
import { useMapStore } from "../store";


import AircraftTooltip from "./AircraftTooltip.vue";

export default {
  components: {
    LLayerGroup,
    LTooltip,
    LPopup,
    AircraftTooltip,
    "v-rotated-marker": LMarkerRotate,
    //LMarkerClusterGroup,
  },
  data() {
    return {
      staticAnchor: [16, 37],
      selected: {},
      channel: null,
      planeData: [],
      // hoverItem: null,
      store: useMapStore(),
    };
  },
  computed: {
    socket() {
      return this.store.socket;
    },
    connectionId() {
      return this.store.connectionId;
    },
    altitude() {
      return this.store.altitude;
    },
    showCluster() {
      return this.store.showCluster;
    },
  },
  async mounted() {
    console.log(`joinning streaming channel ...`);

    // set a interval to check if the socket is ready
    const checkSocketInterval = setInterval(async () => {
      if (this.socket) {
        console.log(`${this.connectionId} socket is ready`, this.socket);
        clearInterval(checkSocketInterval);
        await this.joinStreamingChannel(`streaming-${this.connectionId}`);
        await this.store.pushSystemEvent('join-streaming', { connectionId: this.store.connectionId });
      } else {
        console.log("wait for socket: ", this.socket);
      }
    }, 1000);
  },
  methods: {
    newDataHandler({ aircraft, count }) {
      // console.log('total: ', aircraft.length);

      const now = Math.floor(Date.now() / 1000);
      if (aircraft && aircraft.length > 0) {
        // only the aircraft has been seen in the last 10 minutes
        var recent = aircraft.filter(item => item.lastseen >= now - 600);
        const arr = recent.filter(
          (item) => item.latitude && item.longitude && item.altitude >= this.altitude[0] && item.altitude <= this.altitude[1],
        );
        arr.forEach((item) => {
          item.latitude = Number(item.latitude);
          item.longitude = Number(item.longitude);
        });
        this.planeData = arr.concat();
        // update metrics
        this.store.setCount(count);
        // console.log(this.store.bounds);
        const visible = arr.filter(item =>
          this.store.bounds == null ||
          this.store.bounds.contains([item.latitude, item.longitude])
        );
        this.store.setVisible(visible.length);
      }
    },
    // newSelectedHandler(data) {
    //   console.info('server event, new selected aircraft: ', data.icao24);
    //   console.info(this.planeData);
    //   this.selected = this.planeData.find(e => e.icao24 === data.icao24);
    //   console.log('new selected aircraft: ', this.selected);
    //
    //   this.store.setSelected(this.selected)
    // },
    joinStreamingChannel(channelName = "streaming") {
      return new Promise((resolve, reject) => {
        if (this.channel) {
          console.log("streaming channel already initiated: ", this.channel);
          return;
        }
        // const channelName = "streaming";
        this.channel = this.socket.channel(channelName);

        this.channel.on("new-data", this.newDataHandler.bind(this));
        // this.channel.on("new-selected", this.newSelectedHandler.bind(this));

        this.channel
          .join()
          .receive("ok", ({ messages }) => {
            console.log(`${channelName} / joined:`, messages);
            resolve(messages);
          })
          .receive("error", ({ reason }) => {
            console.log(`${channelName} / failed to join:`, reason);
            reject(reason);
          })
          .receive("timeout", () => {
            console.log(`${channelName} / timeout joining`);
            reject("timeout");
          });
      });
    },
    // get token for channel
    // params: channel string
    async getChannelToken(channel) {
      try {
        return await fetch("/channel-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: channel }), // optinally give an id
        }).json();
      } catch (e) {
        console.error("error getting channel token", e);
      }
    },
    getRotate(feature) {
      // get rotation of marker
      let iconProps = get_image_object(feature.typecode, feature.callsign);
      return (feature.track + iconProps.rotcorr) % 360;
    },
    getIcon(feature) {
      // console.log('getIcon', feature);

      // set marker style
      let iconProps = get_image_object(feature.typecode, feature.callsign);
      let bbox = Raphael.pathBBox(iconProps.path);
      let x = Math.floor(bbox.x + bbox.width / 2.0);
      let y = Math.floor(bbox.y + bbox.height / 2.0);
      let center = { x, y };
      let offs_x = 0;
      if (iconProps.ofX) {
        offs_x = iconProps.ofX;
      }
      let offs_y = 0;
      if (iconProps.ofY) {
        offs_y = iconProps.ofY;
      }

      var transform =
        "T" +
        (-1 * center.x + offs_x) +
        "," +
        (-1 * center.y + offs_y) +
        "S" +
        iconProps.scale * 0.7;
      var newPath = Raphael.mapPath(
        iconProps.path,
        Raphael.toMatrix(iconProps.path, transform),
      );
      let viewBox = 'viewBox="' + [-16, -16, 32, 32].join(" ") + '"';
      let svgDynProps = { stroke: "#0014aa", strokeWdt: 0.65 };
      let pathPlain =
        "<path stroke=" +
        svgDynProps.stroke +
        " stroke-width=" +
        svgDynProps.strokeWdt +
        " d=" +
        newPath +
        "/>";
      let svgPlain =
        '<svg id="' +
        feature.icao24 +
        '"version="1.1" shape-rendering="geometricPrecision" width="32px" height="32px" ' +
        viewBox +
        ' xmlns="http://www.w3.org/2000/svg">' +
        pathPlain +
        "</svg>";

      return L.divIcon({
        html: svgPlain,
        className: this.iconClassName(feature),
        iconSize: [33, 35], // width and height of the image in pixels
        iconAnchor: [16.5, 17.5], // point of the icon which will correspond to marker's location
        popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
      });
    },

    iconClassName(feature) {
      if (feature.class !== undefined) {
        return "aircraft_" + feature.class;
      }
      const state = this.store.aircraftState[feature.icao24];
      if (state !== undefined) {
        return "aircraft_" + state;
      }
      return feature.icao24 === this.selected.icao24
        ? "aircraft_selected"
        : "aircraft_default";
    },

    showRoute() {
      /* HACK:
       * marker component from leaflet can not bind the click event, it will get wrong click item,
       * so we are using a internal component from leaflet, l-popup. It shows a popup modal when user clicking the marker,
       * this internal component can get the correct info, and we set this popup modal `visibility=hidden`, so it will display a modal in html element but hidden for the user.
       * `setTimeout` here waits for the popup modal being updated, so we can know which popup modal is displaying, and then we
       * can find the popup modal's id attribute which is icao24, then we can find the correct plane info in planeData
       */
      setTimeout(() => {
        if (!this.$refs.popup) return;

        const obj = this.$refs.popup.find((e) => {
          return (
            e?.parentElement?.parentElement?.style?.display !== "none" &&
            e?.parentElement?.parentElement?.parentElement?.parentElement?.style
              ?.opacity === "1"
          );
        });

        if (!obj || !obj.id) return;

        const selectedPlane = this.planeData.find(
          (e) => obj.id.indexOf(e.icao24) === 6,
        );
        if (selectedPlane) {
          this.selected = selectedPlane;
          this.store.setSelected(this.selected);
        }
      }, 100);
    },
  },
};
</script>
<style>
.tooltip {
  border-radius: 10px;
}

.leaflet-popup-pane {
  opacity: 0;
}

.leaflet-tooltip:not(:last-child) {
  display: none;
}

.leaflet-tooltip-custom {
  font-family: "B612", sans-serif;
}

.aircraft_default svg {
  fill: #f9fd15;
}

.aircraft_selected svg {
  fill: #ff6464;
}
</style>
