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

    <div ref="mapContainer" class="map-container">
      <div v-if="visibleSidebarWidgets.length > 0" class="sidebar-container">
        <div
          v-for="widget in visibleSidebarWidgets"
          :key="widget.id"
          class="sidebar-section"
        >
          <div class="sidebar-header" @click="toggleSection(widget)">
            <svg
              class="caret"
              :class="{ open: !widget.isCollapsed }"
              viewBox="0 0 24 24"
              width="16"
              height="16"
            >
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
            {{ widget.title || widget.id }}
          </div>
          <div v-show="!widget.isCollapsed" class="sidebar-body">
            <component :is="widget.id" />
          </div>
        </div>
      </div>
      <component
        :is="widget.id"
        v-for="widget in tangramApi.ui.widgets.MapOverlay"
        :key="widget.id"
      />
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
import { onMounted, onUnmounted, getCurrentInstance, ref, watch, computed } from "vue";
import maplibregl from "maplibre-gl";
import { TangramApi, type WidgetEntry } from "./api";
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

const visibleSidebarWidgets = computed((): WidgetEntry[] => {
  if (!tangramApi.value) return [];
  const activeEntities = tangramApi.value.state.activeEntities;

  const activeTypes = new Set<string>();
  if (activeEntities) {
    for (const entity of activeEntities.values()) {
      activeTypes.add(entity.type);
    }
  }

  return tangramApi.value.ui.widgets.SideBar.filter(widget => {
    if (!widget.relevantFor) return true;

    const widgetTypes = Array.isArray(widget.relevantFor)
      ? widget.relevantFor
      : [widget.relevantFor];
    return widgetTypes.some(t => activeTypes.has(t));
  });
});

const toggleSection = (widget: WidgetEntry) => {
  widget.isCollapsed = !widget.isCollapsed;
};

watch(
  () => tangramApi.value?.state.activeEntities.value,
  newEntities => {
    if (!tangramApi.value || !newEntities) return;

    const activeTypes = new Set<string>();
    for (const entity of newEntities.values()) {
      activeTypes.add(entity.type);
    }

    for (const widget of tangramApi.value.ui.widgets.SideBar) {
      if (widget.relevantFor) {
        const widgetTypes = Array.isArray(widget.relevantFor)
          ? widget.relevantFor
          : [widget.relevantFor];
        if (widgetTypes.some(t => activeTypes.has(t))) {
          widget.isCollapsed = false;
        }
      }
    }
  },
  { deep: true }
);

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

/* sidebar */
.sidebar-container {
  font-family: "B612", sans-serif;
  position: absolute;
  top: 10px;
  left: 10px;
  width: 21rem;
  max-height: calc(100% - 20px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  scrollbar-width: thin;
}

.sidebar-section {
  background-color: rgba(255, 255, 255, 0.95);
  color: #333;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  pointer-events: auto;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.sidebar-header {
  padding: 4px;
  background-color: #f8f9fa;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  font-size: 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  color: #222;
  transition: background-color 0.2s ease;
}

.sidebar-header:hover {
  background-color: #e9ecef;
}

.sidebar-body {
  padding: 0;
  background-color: white;
}

.caret {
  display: inline-block;
  margin-right: 8px;
  transition: transform 0.15s ease;
  color: #666;
  width: 16px;
  height: 16px;
}

.caret.open {
  transform: rotate(90deg);
}

/* map and controls */
.map-container {
  flex: 1;
  flex-grow: 1;
  position: relative;
}

.control-attribution {
  display: none !important;
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
  border-radius: 10px;
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
