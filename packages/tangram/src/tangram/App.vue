<template>
  <div class="shell">
    <h1>@open-aviation/tangram</h1>
    <div class="widgets-container">
      <div v-for="(component, widgetId) in widgets" :key="widgetId" class="widget">
        <component :is="component" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, getCurrentInstance } from 'vue';
import { createTangramApi, registeredWidgets } from './tangram-api';
import { loadPlugins } from './plugin';

const widgets = registeredWidgets;

onMounted(() => {
  const app = getCurrentInstance()!.appContext.app;
  const tangramApi = createTangramApi(app);
  loadPlugins(tangramApi);
});
</script>

<style scoped>
.shell {
  font-family: sans-serif;
  border: 2px solid #42b883;
  padding: 1rem;
}
.widgets-container {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.widget {
  border: 1px solid #ccc;
  padding: 1rem;
  min-width: 200px;
}
</style>

    