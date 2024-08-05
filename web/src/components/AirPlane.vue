<template>
  <v-rotated-marker :rotationAngle="getRotate(item)" v-for="(item, index) in planeData" @click="showRoute"
                    :icon="getIcon(item)"
                    :class="selected.icao24 === item.icao24 ? 'aircraft_selected' : 'aircraft_img'" :key="index"
                    :lat-lng="[item.latitude, item.longitude]">
    <l-tooltip>
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
</template>
<script>
import "leaflet/dist/leaflet.css";
import { LPopup, LTooltip} from '@vue-leaflet/vue-leaflet';
import {LMarkerRotate} from 'vue-leaflet-rotate-marker';
import {get_image_object} from './PlanePath';
import Raphael from 'raphael';
import store from '../store'
import L from 'leaflet'

export default {
  components: {
    LTooltip,
    LPopup,
    'v-rotated-marker': LMarkerRotate
  },
  data() {
    return {
      staticAnchor: [16, 37],
      selected: {},
      streamingChannel: null,
      planeData: [],
    }
  },
  computed: {
    socket() {
      return store.state.socket
    }
  },
  mounted() {
    if (this.socket && !this.streamingChannel) {
      const streamingChannelName = "channel:streaming";
      const streamingChannelToken = "channel-token";
      this.streamingChannel = this.socket.channel(streamingChannelName, {token: streamingChannelToken});

      this.streamingChannel.on("new-data", data => {
        if (data && data.length > 0) {
          this.planeData = data.filter(item => item.latitude && item.longitude)
        }
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
      let iconProps = get_image_object(
          feature.typecode,
          feature.callsign
      );
      let rotate = (feature.track + iconProps.rotcorr) % 360
      return rotate
    },
    getIcon(feature) {
      // set marker style
      let iconProps = get_image_object(
          feature.typecode,
          feature.callsign
      );
      let bbox = Raphael.pathBBox(iconProps.path);
      let x = Math.floor(bbox.x + bbox.width / 2.0);
      let y = Math.floor(bbox.y + bbox.height / 2.0);
      let center = {x: x, y: y};
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
          Raphael.toMatrix(iconProps.path, transform)
      );

      let viewBox = 'viewBox="' + [-16, -16, 32, 32].join(" ") + '"';
      let svgDynProps = {
        stroke: "#0014aa",
        strokeWdt: 0.65,
      };

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
        className:
            feature.icao24 === this.selected.icao24 && feature.callsign === this.selected.callsign && feature.typecode === this.selected.typecode
                ? "aircraft_selected"
                : "aircraft_img",
        iconSize: [33, 35], // width and height of the image in pixels
        iconAnchor: [16.5, 17.5], // point of the icon which will correspond to marker's location
        popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
      })
    },

    showRoute() {
      /*
        marker component from leaflet can not bind the click event, it will get wrong click item,
        so we are using a internal component from leaflet --- l-popup, it will show a popup modal when user clicking the marker,
        this internal component can get the correct info, and we set this popup modal visibility= hidden, so it will display a modal in html element but hidden for the user
        setTimeout here is to waiting for the popup modal updated, so we can know which popup modal is displaying, and then we can find the popup modal's id attribute which is icao24,
        then we can find the correct plane info in planeData
       */
      setTimeout(() => {
        const obj = this.$refs.popup.find(e => e.parentElement.parentElement.style.display !== 'none' && e.parentElement.parentElement.parentElement.parentElement.style.opacity === '1')
        this.selected = this.planeData.find(e => obj.id.indexOf(e.icao24) === 6)
        store.commit('setSelected', this.selected)
      }, 100)

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
</style>
