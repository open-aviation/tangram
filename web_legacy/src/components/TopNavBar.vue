<template>
  <div class="navbar navbar-default navbar-fixed-top" role="navigation">
    <div class="container-fluid">
      <AircraftCount />
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
