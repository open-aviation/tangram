<template>
  <div id="sidebar" class="leaflet-sidebar"
    :class="{ 'collapsed': !showDrawer }">
    <div class="leaflet-sidebar-tabs">
      <ul role="tablist">
        <li>
          <a @click="closeDrawer" role="tab">
            <span class="fa fa-plane"></span>
          </a>
        </li>
      </ul>
    </div>
    <div class="leaflet-sidebar-content">
      <MultiCharts v-show="show" />

    </div>

  </div>
</template>
<script>
import { useMapStore } from "../store";
import MultiCharts from "./MultiCharts.vue";

export default {
  components: {
    MultiCharts
  },
  data() {
    return {
      show: false,
      store: useMapStore()
    }
  },
  computed: {
    showDrawer() {
      return this.store.showDrawer
    }
  },
  methods: {
    closeDrawer() {
      this.store.switchDrawer()
    }
  }
}
</script>
<style scoped>
.leaflet-sidebar {
  position: absolute;
  /*top: 80px;*/
  bottom: 15px;
  left: 15px;
  width: 21rem;
  height: calc(100% - 95px);
  transform: translate(2.5%, 0%);
  overflow: hidden;
  z-index: 1000;
  display: flex;
}

.leaflet-sidebar.collapsed {
  width: 40px;
  height: 40px;
}

.leaflet-sidebar-left {
  left: 0;
}

.leaflet-sidebar-content {
  flex: 1;
  background-color: rgba(255, 255, 255, 1);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 5px;
}

.leaflet-sidebar-left .leaflet-sidebar-content {
  left: 40px;
  right: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.leaflet-sidebar-right .leaflet-sidebar-content {
  left: 0;
  right: 40px;
}

.leaflet-sidebar.collapsed>.leaflet-sidebar-content {
  overflow-y: hidden;
}

.collapsed>.leaflet-sidebar-content {
  overflow-y: hidden;
}

.leaflet-sidebar-pane {
  left: 0;
  right: 0;
  box-sizing: border-box;
}

.leaflet-sidebar-pane.active {
  display: block;
}

.leaflet-sidebar-header {
  margin: -10px -20px 0;
  height: 40px;
  padding: 0 20px;
  line-height: 40px;
  font-size: 15pt;
  color: #fff;
  background-color: #e7e7e7;
}

.leaflet-sidebar-right .leaflet-sidebar-header {
  padding-left: 40px;
}

.leaflet-sidebar-close {
  position: absolute;
  top: 0;
  width: 40px;
  height: 40px;
  text-align: center;
  cursor: pointer;
}

.leaflet-sidebar-left .leaflet-sidebar-close {
  right: 0;
}

.leaflet-sidebar-right .leaflet-sidebar-close {
  left: 0;
}

.leaflet-sidebar {
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.65);
}

@media (min-width: 768px) {
  .leaflet-sidebar {
    border-radius: 4px;
  }

  .leaflet-sidebar.leaflet-touch {
    border: 2px solid rgba(0, 0, 0, 0.2);
  }
}

.leaflet-sidebar-left.leaflet-touch {
  box-shadow: none;
  border-right: 2px solid rgba(0, 0, 0, 0.2);
  opacity: 0.8;
  height: 100%;
}

.leaflet-sidebar-right.leaflet-touch {
  box-shadow: none;
  border-left: 2px solid rgba(0, 0, 0, 0.2);
}


.leaflet-sidebar-tabs,
.leaflet-sidebar-tabs>ul {
  width: 40px;
  margin: 0;
  padding: 0;
  list-style-type: none;
}

.leaflet-sidebar-tabs>li,
.leaflet-sidebar-tabs>ul>li {
  width: 40px;
  height: 40px;
  color: #333;
  font-size: 12pt;
  font-family: "B612", monospace;
  overflow: hidden;
  transition: all 80ms;
}

.leaflet-sidebar-tabs>li>a,
.leaflet-sidebar-tabs>ul>li>a {
  display: block;
  width: 40px;
  height: 100%;
  line-height: 40px;
  color: inherit;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
}


/*
@media (min-width: 768px) {
  .leaflet-sidebar-left {
    left: 0px;
  }
}

.leaflet-sidebar-right {
  right: 0;
}

@media (min-width: 768px) {
  .leaflet-sidebar-right {
    right: 10px;
  }
}

.leaflet-sidebar-tabs {
  top: 0;
  bottom: 0;
  height: 100%;
  background-color: #fff;
}

.leaflet-sidebar-left .leaflet-sidebar-tabs {
  left: 0;
  border-right: 1px solid #e7e7e7;
}

.leaflet-sidebar-right .leaflet-sidebar-tabs {
  right: 0;
}

.leaflet-sidebar-tabs>li:hover,
.leaflet-sidebar-tabs>ul>li:hover {
  color: #000;
  background-color: #eee;
}

.leaflet-sidebar-tabs>li.active,
.leaflet-sidebar-tabs>ul>li.active {
  color: #000;
}


.leaflet-sidebar-tabs>li.disabled>a,
.leaflet-sidebar-tabs>ul>li.disabled>a {
  cursor: default;
}

.leaflet-sidebar-tabs>ul+ul {
  bottom: 0;
}
.bottom-bar-info {
  height: 50px;
  font-size: 20px;
  text-align: center;
}


@media (min-width: 768px) {
  .leaflet-sidebar-right~.leaflet-control-container .leaflet-right {
    transition: right 80ms;
  }
}

@media (min-width: 768px) and (max-width: 1199px) {
  .leaflet-sidebar-right~.leaflet-control-container .leaflet-right {
    right: 315px;
  }
}

@media (min-width: 1200px) {
  .leaflet-sidebar-right~.leaflet-control-container .leaflet-right {
    right: 315px;
  }
}

.leaflet-sidebar-right~.leaflet-control-container .leaflet-right {
  right: 50px;
}

table.info_box_table {
  width: 100%;
  margin: 0px 0px 0px 0px;
  font-family: "B612", sans-serif;
}

.info_header td {
  background-color: #e7e7e7;
  font-family: "B612", sans-serif;
  padding: 3px 8px 2px 8px;
  font-size: 15pt;
  height: 40px;
}

.info_label td {
  font-family: "B612", sans-serif;
  font-size: 12pt;
  color: #555555;
  background-color: #ffffff;
  padding: 2px 8px 0px 8px;
  margin: 0px;
}

.info_value td {
  font-family: "B612", sans-serif;
  font-weight: bold;
  padding: 1px 8px 4px 8px;
  margin: 0px;
  border-bottom: 1px solid #e7e7e7;
  background-color: #ffffff;
}*/
</style>
