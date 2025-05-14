<template>
  <l-layer-group>
    <v-rotated-marker v-for="(item, index) in planeData" :key="index"
      @click="showRoute" :autofocus="false" :icon="getIcon(item)"
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
    // LMarkerClusterGroup,
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
    console.log(`AirPlane mounted ...`);
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

    getRotate(feature) {
      let iconProps = get_image_object(feature.typecode, feature.callsign);
      return (feature.track + iconProps.rotcorr) % 360;
    },
    /**
     * Get the icon for the aircraft marker
     * @param {Object} feature - The aircraft feature object
     * @returns {L.divIcon} The Leaflet divIcon for the aircraft
     */
    getIcon(feature) {
      // Get aircraft icon properties based on type and callsign
      const iconProps = get_image_object(feature.typecode, feature.callsign);
      const iconHtml = this.createAircraftSvg(feature.icao24, iconProps);
      return L.divIcon({
        html: iconHtml,
        className: this.iconClassName(feature),
        iconSize: [33, 35],
        iconAnchor: [16.5, 17.5],
        popupAnchor: [0, 0],
      });
    },

    createAircraftSvg(icao24, iconProps) {
      // console.dir(iconProps);

      // Calculate bounding box of the path
      const bbox = Raphael.pathBBox(iconProps.path);

      // Calculate center point of the SVG path
      const centerX = Math.floor(bbox.x + bbox.width / 2.0);
      const centerY = Math.floor(bbox.y + bbox.height / 2.0);

      // Apply offset values if they exist
      const offsetX = iconProps.ofX || 0;
      const offsetY = iconProps.ofY || 0;

      // create transform string to position and scale the icon, then apply it to the path
      const transform = `T${-1 * centerX + offsetX},${-1 * centerY + offsetY}S${iconProps.scale * 0.7}`;
      const transformedPath = Raphael.mapPath(iconProps.path, Raphael.toMatrix(iconProps.path, transform));

      return `
        <svg id="${icao24}" version="1.1" shape-rendering="geometricPrecision" width="32px" height="32px"
             viewBox="-16 -16 32 32" xmlns="http://www.w3.org/2000/svg">
          <path stroke="#0014aa" stroke-width="0.65" d="${transformedPath}"/>
        </svg>
      `.trim();
    },

    iconClassName(feature) {
      if (feature.class !== undefined) return "aircraft_" + feature.class;

      const state = this.store.aircraftState[feature.icao24];
      if (state !== undefined) return "aircraft_" + state;

      return feature.icao24 === this.selected.icao24 ? "aircraft_selected" : "aircraft_default";
    },

    /**
     * Handle aircraft selection when a marker is clicked
     *
     * This is a workaround for a Vue-Leaflet limitation where click events on markers
     * don't provide reliable information about which marker was clicked.
     *
     * How it works:
     * 1. Each aircraft marker has an invisible popup (<l-popup>) attached to it
     * 2. When a marker is clicked, Leaflet automatically shows its popup
     * 3. We wait for the DOM to update (via setTimeout)
     * 4. Then we detect which popup is currently active by examining DOM properties
     * 5. From the popup's ID, we extract the aircraft's ICAO24 code
     * 6. Finally, we find the matching aircraft and set it as selected
     */
    showRoute() {
      // Wait for DOM updates after click before attempting to find the active popup
      setTimeout(() => {
        // Early return if popup references aren't available
        if (!this.$refs.popup) return;

        // Find the active popup by examining CSS display/opacity states
        const activePopup = this.findActivePopup();
        if (!activePopup) return;

        // Get the selected aircraft based on the popup ID
        const selectedAircraft = this.getAircraftFromPopup(activePopup);
        if (selectedAircraft) {
          this.selected = selectedAircraft;
          this.store.setSelected(selectedAircraft);
        }
      }, 100);
    },

    /**
     * Find the currently active popup in the DOM
     * @returns {HTMLElement|null} The active popup element or null if none found
     */
    findActivePopup() {
      return this.$refs.popup.find((element) => {
        // A popup is "active" when its container elements have specific CSS properties
        const parentElement = element?.parentElement?.parentElement;
        const grandParentElement = parentElement?.parentElement?.parentElement;

        return parentElement?.style?.display !== "none" && grandParentElement?.style?.opacity === "1";
      });
    },

    /**
     * Extract aircraft data from a popup element
     * @param {HTMLElement} popupElement - The active popup DOM element
     * @returns {Object|null} The matching aircraft data or null if not found
     */
    getAircraftFromPopup(popupElement) {
      // Check if the popup has a valid ID
      if (!popupElement || !popupElement.id) return null;

      // The popup ID format is "popup-{icao24}", so we extract the icao24 code
      // We can find the starting position of icao24 code by looking for the first
      // occurrence of each aircraft's icao24 in the popup ID string
      return this.planeData.find(
        (aircraft) => popupElement.id.indexOf(aircraft.icao24) === 6
      );
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
