<template>
  <div class="visible_aircraft_box">
    <ul class="nav nav-tabs navbar-nav">
      <li class="nav-item li-center">
        <span id="visible_count">{{ visibleCount }}</span> (<span id="plane_count">{{
          totalCount ?? 0
        }}</span
        >)
      </li>
      <span id="count_aircraft">visible aircraft</span>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";

const tangramApi = inject<Ref<TangramApi | null>>("tangramApi");

const totalCount = computed(() => tangramApi?.value?.state.totalCount);

const visibleCount = computed(
  () => tangramApi?.value?.state.getEntitiesByType("aircraft").value?.size ?? 0
);
</script>

<style scoped>
#visible_count {
  font-size: 1em;
  color: #4c78a8;
}
#count_aircraft {
  color: #79706e;
  font-size: 9pt;
  text-align: center;
}
.visible_aircraft_box {
  margin-right: 1em;
}
.li-center {
  text-align: center;
}
</style>
