<template>
  <v-rotated-marker :rotationAngle="getRotate(item)" v-for="(item, index) in planeData" :icon="getIcon(item)" :key="index" :lat-lng="[item.latitude, item.longitude]" @click="showRoute(item)">
  </v-rotated-marker>
</template>
<script>
import "leaflet/dist/leaflet.css";
import {LMarker, LIcon} from '@vue-leaflet/vue-leaflet';
import { LMarkerRotate } from 'vue-leaflet-rotate-marker';
import {get_image_object} from './PlanePath';
import Raphael from 'raphael';
export default {
  components: {
    LMarker,
    LIcon,
    'v-rotated-marker': LMarkerRotate
  },
   data() {
     return {
       staticAnchor: [16, 37],
       selected: {}
     }
   },
  props: {
    planeData: {
      type: Array,
      default() {
        return []
      }
    }
  },

  methods: {
    getRotate(feature) {
      let iconProps = get_image_object(
          feature.typecode,
          feature.callsign
      );
      let rotate = (feature.track + iconProps.rotcorr) % 360
      return rotate
    },
    getIcon(feature) {
      let iconProps = get_image_object(
          feature.typecode,
          feature.callsign
      );
      let bbox = Raphael.pathBBox(iconProps.path);
      let x = Math.floor(bbox.x + bbox.width / 2.0);
      let y = Math.floor(bbox.y + bbox.height / 2.0);
      let center = { x: x, y: y };
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

      return  L.divIcon({
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

    showRoute(item) {
      this.selected = item
      this.$emit('onSelectPlane', item)
    }
  }
}
</script>
<style>

</style>
