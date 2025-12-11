<template>
  <div v-if="apiState === 'loading'" class="loading-container">
    <div>initialising tangram…</div>
    <div v-if="loadingMessage" class="loading-detail">{{ loadingMessage }}</div>
  </div>
  <div v-else-if="apiState === 'error'">
    error: could not connect to the tangram backend.
  </div>
  <div v-else-if="apiState === 'ready' && tangramApi" class="main-container">
    <div class="navbar" role="navigation">
      <div class="navbar-brand">
        <img src="/favicon.png" alt="tangram" class="navbar-logo" />
        <span class="navbar-title">tangram</span>
      </div>

      <div class="navbar-spacer"></div>

      <component
        :is="widget.id"
        v-for="widget in tangramApi.ui.widgets.TopBar"
        :key="widget.id"
      />
    </div>

    <div
      id="sidebar"
      class="sidebar"
      :class="{
        collapsed: !tangramApi.state.activeEntity || tangramApi.ui.isSidebarCollapsed
      }"
    >
      <div class="sidebar-tabs">
        <ul role="tablist">
          <li>
            <a role="tab" @click="tangramApi.ui.toggleSidebar()">
              <span class="fa fa-plane"></span>
            </a>
          </li>
        </ul>
      </div>
      <div class="sidebar-content">
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
      <!-- map controls must be children of map-container to be positioned absolutely within it -->
      <div v-if="tangramApi && tangramApi.map.isReady" class="map-controls">
        <button
          v-if="
            tangramApi.config.map.allow_bearing &&
            Math.abs(tangramApi.map.bearing) > 0.1
          "
          class="map-btn"
          title="Reset Bearing (North)"
          @click="resetBearing"
        >
          <svg
            viewBox="0 0 100 100"
            class="compass-icon"
            :style="{ transform: `rotate(${-tangramApi.map.bearing}deg)` }"
          >
            <path d="M50 15 L65 50 L50 50 Z" fill="#e74c3c" />
            <path d="M50 15 L35 50 L50 50 Z" fill="#c0392b" />
            <path d="M50 85 L65 50 L50 50 Z" fill="#ecf0f1" />
            <path d="M50 85 L35 50 L50 50 Z" fill="#bdc3c7" />
          </svg>
        </button>
        <button
          v-if="tangramApi.config.map.allow_pitch && tangramApi.map.pitch > 0.1"
          class="map-btn"
          title="Reset Pitch (2D)"
          @click="resetPitch"
        >
          2D
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, getCurrentInstance, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import { TangramApi } from "./api";
import { loadPlugins } from "./plugin";
import { layers, namedFlavor } from "@protomaps/basemaps";
import * as pmtiles from "pmtiles";

type ApiState = "loading" | "ready" | "error";

const app = getCurrentInstance()!.appContext.app;
const apiState = ref<ApiState>("loading");
const loadingMessage = ref<string>("");
const tangramApi = ref<TangramApi | null>(null);
const mapContainer = ref<HTMLElement | null>(null);
let mapInstance: maplibregl.Map | undefined = undefined;

onMounted(async () => {
  try {
    const api = await TangramApi.create(app);
    app.provide("tangramApi", api);
    await loadPlugins(api, progress => {
      if (progress.stage === "manifest") {
        loadingMessage.value = "fetching plugin manifest";
      } else if (progress.stage === "plugin" && progress.pluginName) {
        loadingMessage.value = `loading plugin: ${progress.pluginName}`;
      } else if (progress.stage === "done") {
        loadingMessage.value = "starting user interface";
      }
    });
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
    const mapConfig = tangramApi.value.config.map;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    if (typeof mapConfig.style === "object") {
      // If the style is an object, we need to ensure it has the correct structure
      // First we need to remove all None/null values from the style object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const removeNulls = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(removeNulls);
        }
        if (typeof obj === "string") {
          // This is a special case if we don't want to hardcode the root URL
          // of the application in the style JSON, we can use #ROOT# as a placeholder
          if (obj.includes("#ROOT#")) {
            const rootUrl =
              window.location.origin +
              window.location.pathname.replace(/\/[^\/]*$/, "/");
            return obj.replace(/#ROOT#/g, rootUrl);
          }
          return obj;
        }
        if (obj !== null && typeof obj === "object") {
          return Object.entries(obj).reduce((acc, [key, value]) => {
            if (value !== null && value !== undefined) {
              acc[key] = removeNulls(value);
            }
            return acc;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }, {} as any);
        }
        return obj;
      };

      const styleObject = removeNulls(mapConfig.style);

      if (!styleObject.layers) {
        styleObject.layers = layers("protomaps", namedFlavor("light"), {
          lang: mapConfig.lang
        });
      }
      mapConfig.style = styleObject;
    }

    // @ts-expect-error TS2589: Type instantiation is excessively deep and possibly infinite
    mapInstance = new maplibregl.Map({
      container: newEl,
      style: mapConfig.style,
      center: [mapConfig.center_lon, mapConfig.center_lat],
      zoom: mapConfig.zoom,
      pitch: mapConfig.pitch,
      bearing: mapConfig.bearing,
      attributionControl: false,
      minZoom: mapConfig.min_zoom,
      maxZoom: mapConfig.max_zoom,
      maxPitch: mapConfig.allow_pitch ? mapConfig.max_pitch : 0,
      dragRotate: mapConfig.allow_bearing,
      touchZoomRotate: mapConfig.allow_bearing,
      pitchWithRotate: mapConfig.allow_pitch
    });

    tangramApi.value.map.initialize(mapInstance);
  }
});

const resetBearing = () => {
  tangramApi.value?.map.getMapInstance().easeTo({ bearing: 0 });
};

const resetPitch = () => {
  tangramApi.value?.map.getMapInstance().easeTo({ pitch: 0 });
};

onUnmounted(() => {
  tangramApi.value?.map.dispose();
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = undefined;
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
  margin: 0;
  padding: 0;
}

.main-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.navbar {
  min-height: 50px;
  background: white;
  z-index: 500;
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.5rem;
  border-bottom: 1px solid #e7e7e7;
}

.navbar-brand {
  display: flex;
  align-items: center;
}

.navbar-logo {
  height: 24px;
  margin-right: 5px;
}

.navbar-title {
  padding-top: 0.3125rem;
  padding-bottom: 0.3125rem;
  font-size: 1.25rem;
  margin-bottom: 0;
  color: black;
}

.navbar-spacer {
  margin-left: auto;
}

.sidebar {
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

.sidebar.collapsed {
  width: 40px;
  height: 40px;
}

.sidebar-tabs,
.sidebar-tabs > ul {
  width: 40px;
  margin: 0;
  padding: 0;
  list-style-type: none;
  border-right: 1px solid #ddd;
}

.sidebar-tabs > li,
.sidebar-tabs > ul > li {
  width: 40px;
  height: 40px;
  color: #333;
  font-size: 12pt;
  font-family: "B612", monospace;
  overflow: hidden;
  transition: all 80ms;
}

.sidebar-tabs > li > a,
.sidebar-tabs > ul > li > a {
  display: block;
  width: 40px;
  height: 100%;
  line-height: 40px;
  color: inherit;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
}

.sidebar-content {
  flex: 1;
  background-color: rgba(255, 255, 255, 1);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
}

.sidebar.collapsed > .sidebar-content {
  overflow-y: hidden;
}

.map-container {
  flex: 1;
  flex-grow: 1;
  position: relative;
}

.control-attribution {
  display: none !important;
}

.top,
.bottom {
  z-index: 400;
}

.loading-container {
  padding: 1.5rem;
}

.loading-detail {
  margin-top: 0.5rem;
  color: #555;
}

.map-controls {
  position: absolute;
  bottom: 30px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
  pointer-events: auto;
}

.map-btn {
  width: 32px;
  height: 32px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "B612", sans-serif;
  font-weight: bold;
  font-size: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  padding: 2px;
}

.map-btn:hover {
  background-color: #f0f0f0;
}

.compass-icon {
  width: 100%;
  height: 100%;
  transition: transform 0.1s linear;
}
</style>
