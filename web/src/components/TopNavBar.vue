<template>
  <div class="navbar navbar-default navbar-fixed-top" role="navigation">
    <div class="container-fluid">
      <div style="display: flex; align-items: center">
        <span class="navbar-brand mb-0 mr-2 h" style="color: black">tangram</span>
        <AltitudeSlider />
        <span class="mr-1 ml-2">Show cluster</span>
        <input :checked="showCluster" type="checkbox" @change="onChange" />
        <span class="mr-1 ml-2">Map style</span>
        <select class="ml-1" @change="onChangeMap" v-model="selectedOption">
          <option v-for="item in mapOptions" :key="item.name" :value="item.url">{{item.name}}</option>
        </select>
        <div class="ml-1">
          <input @change="onChangeDefault" type="checkbox" v-model="setAsDefault" /> Set as default
        </div>
      </div>
      <ul class="nav nav-tabs navbar-nav">
        <li class="nav-item clock">
          <span id="info_utc" v-html="info_utc"></span>Z |
          <span id="info_local" v-html="info_local"></span>
        </li>
        <span id="uptime" v-html="uptime"></span>
      </ul>
      <div class="navbar-collapse collapse"></div>
    </div>
  </div>
</template>
<script>
import {useMapStore} from "../store";
import AltitudeSlider from "./AltitudeSlider.vue";
import mapOptions from "../config/mapTileConfig.js";
export default {
  components: {AltitudeSlider},
  data() {
    return {
      setAsDefault: false,
      store: useMapStore(),
      mapOptions,
      selectedOption:  mapOptions[0].url
    }
  },
  mounted() {
    if(this.hasDefault) {
      this.setAsDefault = true
      const d = mapOptions.find(item => item.url === this.hasDefault)
      if(d) {
        this.selectedOption = d.url
      } else {
        this.selectedOption = ''
      }
      this.$emit("changeMap", this.hasDefault);
    }
  },
  methods: {
    onChangeDefault(e) {
      this.store.setDefaultUrl(this.store.defaultUrl);
    },
    onChangeMap(e) {
      this.setAsDefault = false
      this.$emit("changeMap", e.target.value);
    },
    onChange(v) {
      this.store.setCluster(v.target.checked)
    }
  },
  computed: {
    hasDefault() {
      return this.store.getDefaultUrl
    },
    showCluster() {
      return this.store.showCluster
    },
    info_utc() {
      return this.store.info_utc
    },
    info_local() {
      return this.store.info_local
    },
    uptime() {
      return this.store.uptime
    }
  }
}
</script>
<style>
.navbar {
  min-height: 50px;
  background: white;
  z-index: 500;
}
#uptime {
  font-size: 9pt;
  text-align: center;
}
.mr-2 {
  margin-right: 2rem;
}
.ml-2 {
  margin-left: 2rem;
}
.ml-1 {
  margin-left: 1rem;
}
.mr-1 {
  margin-right: 1rem;
}
</style>
