<template>
  <div class="navbar navbar-default navbar-fixed-top" role="navigation">
    <div class="container-fluid">
      <span class="navbar-brand mb-0 h" style="color: black">tangram</span>
      <ul class="nav nav-tabs navbar-nav">
        <li class="nav-item clock">
          <span id="info_utc" v-html="info"></span>Z | <span id="info_local"></span> <span id="uptime" v-html="uptime"></span>
        </li>
      </ul>
      <div class="navbar-collapse collapse"></div>
    </div>
  </div>
</template>
<script>
import store from "../store";
export default {
  computed: {
    info() {
      return store.state.info
    },
    uptime() {
      return store.state.uptime
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
