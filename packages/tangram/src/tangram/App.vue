<template>
  <!-- NOTE: copied largely from v0.1. -->
  <div v-if="apiState === 'loading'">loading...</div>
  <div v-else-if="apiState === 'error'">
    error: could not connect to the tangram backend.
  </div>
  <div v-else-if="apiState === 'ready' && tangramApi" class="main-container">
    <div class="navbar navbar-default navbar-fixed-top" role="navigation">
      <div class="container-fluid">
        <div style="display: flex; align-items: center">
          <img
            src="/favicon.png"
            alt="tangram"
            style="height: 30px; margin-right: 5px"
          />
          <span class="navbar-brand mb-0 mr-2 h" style="color: black">tangram</span>
        </div>

        <div style="margin-left: auto"></div>

        <component
          :is="widget.id"
          v-for="widget in tangramApi.ui.widgets.TopBar"
          :key="widget.id"
        />
        <div class="navbar-collapse collapse"></div>
      </div>
    </div>

    <div
      id="sidebar"
      class="leaflet-sidebar"
      :class="{
        collapsed: !tangramApi.state.activeEntity || tangramApi.ui.isSidebarCollapsed
      }"
    >
      <div class="leaflet-sidebar-tabs">
        <ul role="tablist">
          <li>
            <a role="tab" @click="tangramApi.ui.toggleSidebar()">
              <span class="fa fa-plane"></span>
            </a>
          </li>
        </ul>
      </div>
      <div class="leaflet-sidebar-content">
        <component
          :is="widget.id"
          v-for="widget in tangramApi.ui.widgets.SideBar"
          :key="widget.id"
        />
      </div>
    </div>

    <div ref="mapContainer" class="map-container">
      <component
        :is="widget.id"
        v-for="widget in tangramApi.ui.widgets.MapOverlay"
        :key="widget.id"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  onMounted,
  onUnmounted,
  getCurrentInstance,
  provide,
  ref,
  watch,
  type Ref
} from "vue";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TangramApi } from "./api";
import { loadPlugins } from "./plugin";

type ApiState = "loading" | "ready" | "error";

const app = getCurrentInstance()!.appContext.app;
const apiState = ref<ApiState>("loading");
const tangramApi: Ref<TangramApi | null> = ref(null);
const mapContainer = ref<HTMLElement | null>(null);
let mapInstance: L.Map | null = null;

provide("tangramApi", tangramApi);

onMounted(async () => {
  try {
    const api = await TangramApi.create(app);
    await loadPlugins(api);
    tangramApi.value = api;
    apiState.value = "ready";
  } catch (e) {
    console.error("failed to initialise tangram api:", e);
    apiState.value = "error";
  }
});

watch(
  () => tangramApi.value?.state.activeEntity,
  newEntity => {
    if (newEntity) {
      tangramApi.value?.ui.openSidebar();
    }
  }
);

watch(mapContainer, newEl => {
  if (newEl && tangramApi.value && !mapInstance) {
    mapInstance = L.map(newEl).setView([48, 7], 6);
    mapInstance.on("click", () => {
      tangramApi.value!.state.deselectActiveEntity();
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(mapInstance);
    tangramApi.value.map.initialize(mapInstance);
  }
});

onUnmounted(() => {
  tangramApi.value?.map.dispose();
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
});
</script>

<style>
#app {
  height: 100%;
}

/* styles from v0.1 App.vue */
html {
  width: 100%;
  height: 100%;
}

body {
  font-family: "B612", sans-serif;
  width: 100%;
  height: 100%;
}

.main-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.leaflet-sidebar {
  position: absolute;
  bottom: 15px;
  left: 15px;
  width: 21rem;
  height: calc(100% - 95px);
  transform: translate(2.5%, 0%);
  overflow: hidden;
  z-index: 1000;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.65);
  border-radius: 4px;
  display: flex;
}

.leaflet-sidebar.collapsed {
  width: 40px;
  height: 40px;
}

.leaflet-sidebar-tabs,
.leaflet-sidebar-tabs > ul {
  width: 40px;
  margin: 0;
  padding: 0;
  list-style-type: none;
  border-right: 1px solid #ddd;
}

.leaflet-sidebar-tabs > li,
.leaflet-sidebar-tabs > ul > li {
  width: 40px;
  height: 40px;
  color: #333;
  font-size: 12pt;
  font-family: "B612", monospace;
  overflow: hidden;
  transition: all 80ms;
}

.leaflet-sidebar-tabs > li > a,
.leaflet-sidebar-tabs > ul > li > a {
  display: block;
  width: 40px;
  height: 100%;
  line-height: 40px;
  color: inherit;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
}

.leaflet-sidebar-content {
  flex: 1;
  background-color: rgba(255, 255, 255, 1);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
}

.leaflet-sidebar.collapsed > .leaflet-sidebar-content {
  overflow-y: hidden;
}

.leaflet-control-container {
  position: absolute;
  right: 55px;
  bottom: 90px;
}

.map-container {
  flex: 1;
  flex-grow: 1;
}

.leaflet-control-attribution {
  display: none !important;
}

.leaflet-top,
.leaflet-bottom {
  z-index: 400;
}

/* styles from v0.1 TopNavBar.vue */
.navbar {
  min-height: 50px;
  background: white;
  z-index: 500;
}

.mr-2 {
  margin-right: 2rem;
}
</style>
