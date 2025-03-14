<template>
  <div class="navbar navbar-default navbar-fixed-top" role="navigation">
    <div class="container-fluid">
      <div style="display: flex; align-items: center">
        <img src="/favicon/favicon.png" alt="tangram"
          style="height: 30px; margin-right: 5px" />
        <span class="navbar-brand mb-0 mr-2 h"
          style="color: black">tangram</span>
        <!--         <span class="mr-1 ml-2">Show cluster</span>
        <input :checked="showCluster" type="checkbox" @change="onChange" /> -->
      </div>

      <!-- this is to flush all other blocks to the right -->
      <div style="margin-left: auto;" />

      <AircraftCount />
      <plugin-time />

      <div class="navbar-collapse collapse"></div>
    </div>
  </div>
</template>
<script>
import { useMapStore } from "../store";
import AircraftCount from "./AircraftCount.vue";

export default {
  components: { AircraftCount },
  data() {
    return {
      store: useMapStore(),
    };
  },
  methods: {
    onChange(v) {
      this.store.setCluster(v.target.checked);
    },
  },
  computed: {
    connecitonId() {
      return this.store.connectionId;
    },
    showCluster() {
      return this.store.showCluster;
    },
    info_utc() {
      return this.store.info_utc;
    },
    info_local() {
      return this.store.info_local;
    },
    uptime() {
      return this.store.uptime;
    },
    count() {
      return this.store.count;
    },
    visible() {
      return this.store.visible;
    },
  },
};
</script>
<style scoped>
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

.mr-1 {
  margin-right: 1rem;
}
</style>
