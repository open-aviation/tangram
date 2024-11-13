<template>
  <div class="navbar navbar-default navbar-fixed-top" role="navigation">
    <div class="container-fluid">
      <span class="navbar-brand mb-0 h" style="color: black">tangram</span>
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
export default {
  data() {
    return {
      store: useMapStore()
    }
  },
  computed: {
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
}
#uptime {
  font-size: 9pt;
  text-align: center;
}
</style>
