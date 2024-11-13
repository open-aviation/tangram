<template>
  <l-control
      :position="'bottomleft'"
      class="custom-control-watermark"
  >
    {{hoverStr}}
  </l-control>
</template>
<script>
import { LControl } from "@vue-leaflet/vue-leaflet";
import {useMapStore} from "../store";
export default {
  components: {
    LControl
  },
  computed: {
    hoverStr() {
      const hover = useMapStore()
      return hover.hoverItem
    }
  },
}
</script>
