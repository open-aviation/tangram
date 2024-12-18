<template>
  <l-layer-group v-if="showCluster">
    <l-marker-cluster-group :maxClusterRadius="20" :removeOutsideVisibleBounds="true">
      <v-rotated-marker v-for="(item, index) in planeData" :key='index'
                        @click="showRoute"
                        :icon="getIcon(item)"
                        :rotationAngle="getRotate(item)"
                        :class="selected.icao24 === item.icao24 ? 'aircraft_selected' : 'aircraft_img'"
                        :lat-lng.sync="[item.latitude, item.longitude]">
        <l-tooltip class="leaflet-tooltip-custom" :id="item.icao24" :options="{ direction: 'top', offset: [0, -10]}">
          <p style="font-size: 14px">
            icao24: <code>{{ item.icao24 }}</code><br/>
            callsign: <code>{{ item.callsign }}</code><br/>
            tail: <code>{{ item.registration }}</code><br/>
            altitude: <code>{{ item.altitude }}</code>
          </p>
        </l-tooltip>
        <l-popup class="popup-leaflet-hidden">
          <div ref="popup" :id="'popup-' + item.icao24">{{ item.icao24 }}</div>
        </l-popup>
      </v-rotated-marker>
    </l-marker-cluster-group>
  </l-layer-group>
  <l-layer-group v-else>
      <v-rotated-marker v-for="(item, index) in planeData" :key='index'
                        @click="showRoute"
                        :icon="getIcon(item)"
                        :rotationAngle="getRotate(item)"
                        :class="selected.icao24 === item.icao24 ? 'aircraft_selected' : 'aircraft_img'"
                        :lat-lng.sync="[item.latitude, item.longitude]">
        <l-tooltip class="leaflet-tooltip-custom" :id="item.icao24" :options="{ direction: 'top', offset: [0, -10]}">
          <p style="font-size: 14px">
            icao24: <code>{{ item.icao24 }}</code><br/>
            callsign: <code>{{ item.callsign }}</code><br/>
            tail: <code>{{ item.registration }}</code><br/>
            altitude: <code>{{ item.altitude }}</code>
          </p>
        </l-tooltip>
        <l-popup class="popup-leaflet-hidden">
          <div ref="popup" :id="'popup-' + item.icao24">{{ item.icao24 }}</div>
        </l-popup>
      </v-rotated-marker>
  </l-layer-group>
</template>
<script>
import L from 'leaflet'
import "leaflet/dist/leaflet.css";
import {LLayerGroup, LPopup, LTooltip} from '@vue-leaflet/vue-leaflet';
import {LMarkerRotate} from 'vue-leaflet-rotate-marker';
import Raphael from 'raphael';
import {get_image_object} from './PlanePath';
import {useMapStore} from '../store'
import {LMarkerClusterGroup} from 'vue-leaflet-markercluster'

import 'leaflet/dist/leaflet.css'
import 'vue-leaflet-markercluster/dist/style.css'

export default {
  components: {
    LLayerGroup,
    LTooltip,
    LPopup,
    'v-rotated-marker': LMarkerRotate,
    LMarkerClusterGroup
  },
  data() {
    return {
      staticAnchor: [16, 37],
      selected: {},
      streamingChannel: null,
      planeData: [],
      // hoverItem: null,
      store: useMapStore(),
    }
  },
  computed: {
    socket() {
      return this.store.socket
    },
    altitude() {
      return this.store.altitude
    },
    showCluster() {
      return this.store.showCluster
    }
  },
  mounted() {
    if (this.socket && !this.streamingChannel) {
      console.log('initiating channel:streaming channel ...');

      const streamingChannelName = "channel:streaming";
      const streamingChannelToken = "channel-token";
      this.streamingChannel = this.socket.channel(streamingChannelName, {token: streamingChannelToken});

      this.streamingChannel.on("new-data", data => {
        if (data && data.length > 0) {
          this.planeData = data.filter(item => item.latitude && item.longitude && item.altitude >= this.altitude[0] && item.altitude <= this.altitude[1])
        }
      });

      this.streamingChannel.on("new-selected", data => {
        console.log('server event, new selected aircraft: ', data.icao24);

        console.dir(this.planeData);
        this.selected = this.planeData.find(e => e.icao24 === data.icao24);
        console.log('new selected aircraft: ', this.selected);

        this.store.setSelected(this.selected)
      });

      this.streamingChannel
          .join()
          .receive("ok", ({messages}) => {
            console.log(`(${streamingChannelName}) joined`, messages);
          })
          .receive("error", ({reason}) =>
              console.log(`failed to join ${streamingChannelName}`, reason)
          )
          .receive("timeout", () => console.log(`timeout joining ${streamingChannelName}`));
    }
  },

  methods: {
    getRotate(feature) {
      // get rotation of marker
      let iconProps = get_image_object(feature.typecode, feature.callsign);
      return (feature.track + iconProps.rotcorr) % 360
    },
    getIcon(feature) {
      // console.log('getIcon', feature);

      // set marker style
      let iconProps = get_image_object(feature.typecode, feature.callsign);
      let bbox = Raphael.pathBBox(iconProps.path);
      let x = Math.floor(bbox.x + bbox.width / 2.0);
      let y = Math.floor(bbox.y + bbox.height / 2.0);
      let center = {x, y};
      let offs_x = 0;
      if (iconProps.ofX) {
        offs_x = iconProps.ofX;
      }
      let offs_y = 0;
      if (iconProps.ofY) {
        offs_y = iconProps.ofY;
      }

      var transform = "T" + (-1 * center.x + offs_x) + "," + (-1 * center.y + offs_y) + "S" + iconProps.scale * 0.7;
      var newPath = Raphael.mapPath(iconProps.path, Raphael.toMatrix(iconProps.path, transform));
      let viewBox = 'viewBox="' + [-16, -16, 32, 32].join(" ") + '"';
      let svgDynProps = { stroke: "#0014aa", strokeWdt: 0.65 };
      let pathPlain = "<path stroke=" + svgDynProps.stroke + " stroke-width=" + svgDynProps.strokeWdt + " d=" + newPath + "/>";
      let svgPlain = '<svg id="' + feature.icao24 + '"version="1.1" shape-rendering="geometricPrecision" width="32px" height="32px" ' + viewBox + ' xmlns="http://www.w3.org/2000/svg">' + pathPlain + "</svg>";

      return L.divIcon({
        html: svgPlain,
        className: feature.icao24 === this.selected.icao24 && feature.callsign === this.selected.callsign && feature.typecode === this.selected.typecode ? "aircraft_selected" : "aircraft_img",
        iconSize: [33, 35], // width and height of the image in pixels
        iconAnchor: [16.5, 17.5], // point of the icon which will correspond to marker's location
        popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
      })
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
        console.dir(this.$refs.popup);
        const obj = this.$refs.popup.find(e => {
          return e.parentElement.parentElement.style.display !== 'none' &&
            e.parentElement.parentElement.parentElement.parentElement.style.opacity === '1'
        });
        console.dir(obj)
        this.selected = this.planeData.find(e => obj.id.indexOf(e.icao24) === 6)
        console.log('new selected aircraft: ', this.selected);

        this.store.setSelected(this.selected)
      }, 100) // 100ms
    }
  }
}
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
</style>
