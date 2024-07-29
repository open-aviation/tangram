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
export default {
  props: ['updateItem'],
  data() {
    return {
      info: '',
      uptime: ''
    }
  },
  watch: {
    updateItem: function(newValue) {
      if(newValue && newValue.el === 'uptime') {
        this.uptime = newValue.html
      }
      if(newValue && newValue.el === 'info_utc') {
        this.info = newValue.html
      }
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
