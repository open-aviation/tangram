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
      <div class="map-container">
        <!-- TODO -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, getCurrentInstance, provide, ref, type Ref } from "vue";
import { TangramApi } from "./api";
import { loadPlugins } from "./plugin";

type ApiState = "loading" | "ready" | "error";

const app = getCurrentInstance()!.appContext.app;
const apiState = ref<ApiState>("loading");
const tangramApi: Ref<TangramApi | null> = ref(null);

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
</script>

<style>
/* Styles from v0.1 App.vue */
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

/* Styles from v0.2 App.vue */
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

/* Styles from v0.1 TopNavBar.vue */
.navbar {
  min-height: 50px;
  background: white;
  z-index: 500;
}

.mr-2 {
  margin-right: 2rem;
}
</style>
