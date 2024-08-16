<template>
  <l-control
      :position="'bottomleft'"
      class="custom-control-watermark"
  >
    {{position}}
  </l-control>
</template>
<script>
import { LControl } from "@vue-leaflet/vue-leaflet";
export default {
  components: {
    LControl
  },
  props: ['position']
}
</script>
