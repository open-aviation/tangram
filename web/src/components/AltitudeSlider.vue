<template>
  <div style="display: flex; align-items: center">
    <span style="margin-right: 20px">Altitude</span>
    <vue-slider
        ref="slider"
        v-model="value"
        :min="0"
        :max="40000"
        :enable-cross="false"
        :width="150"
        :height="8"
        @drag-end="dragEnd"
        :process-style="{backgroundColor: '#808080'}"
        :dot-size="18"
        :dot-style="{border: '2px solid #e0e0e0'}"
        :tooltip-placement="'bottom'"
    ></vue-slider>
  </div>
</template>

<script>
import VueSlider from 'vue-slider-component'
import 'vue-slider-component/theme/antd.css'
import {useMapStore} from "../store/index.js";
export default {
  components: {VueSlider},
  data() {
    return {
      value: [0, 40000],
      store: useMapStore()
    }
  },
  methods: {
    dragEnd() {
      this.store.setAltitude(this.value)
    }
  }
}
</script>

<style scoped>

</style>
