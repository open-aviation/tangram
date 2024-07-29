<template>
  <l-polyline :lat-lngs="polyline" :color="color"></l-polyline>
</template>
<script>
import "leaflet/dist/leaflet.css";
import {LPolyline} from '@vue-leaflet/vue-leaflet';
export default {
  components: {
    LPolyline
  },
  data() {
    return {
      staticAnchor: [16, 37],
      color: 'black'
    }
  },
  props: {
    polyline: {
      type: Array,
      default() {
        return []
      }
    }
  },
}
</script>
<style>
.tooltip {
  border-radius: 10px;
}
</style>
