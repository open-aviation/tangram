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
import store from "../store";
export default {
  components: {
    LControl
  },
  computed: {
    hoverStr() {
      return store.state.hoverItem
    }
  },
}
</script>
