<template>
  <div>
    <ul class="nav nav-tabs navbar-nav">
      <li class="nav-item clock">
        <span id="info_utc" v-html="info_utc"></span>Z |
        <span id="info_local" v-html="info_local"></span>
      </li>
      <span id="uptime" v-html="uptime"></span>
    </ul>
  </div>
</template>

<script>
import { useMapStore } from "../store";

export default {
  data() {
    return {
      store: useMapStore(),
    };
  },
  computed: {
    info_utc() {
      return this.store.info_utc;
    },
    info_local() {
      return this.store.local_time;
    },
    uptime() {
      return this.store.uptime;
    },
  },
};
</script>

<style scoped>
#info_local {
  color: red;
}
</style>
