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

    <div class="content-container">
      <div class="side-bar">
        <component
          :is="widget.id"
          v-for="widget in tangramApi.ui.widgets.SideBar"
          :key="widget.id"
        />
      </div>
      <div ref="mapContainer" class="map-container">
        <component
          :is="widget.id"
          v-for="widget in tangramApi.ui.widgets.MapOverlay"
          :key="widget.id"
        />
      </div>
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

.leaflet-control-container {
  position: absolute;
  right: 55px;
  bottom: 90px;
}

.main-container .map-container {
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

/* styles from v0.2 App.vue */
.content-container {
  flex-grow: 1;
  display: flex;
  position: relative;
  overflow: hidden;
}
.side-bar {
  width: 350px;
  border-right: 1px solid #ddd;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.map-container {
  flex-grow: 1;
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
