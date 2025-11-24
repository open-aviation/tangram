<template>
  <div class="aircraft-count-widget">
    <div class="count-display">
      <span id="visible_count">{{ visibleCount }}</span> (<span id="plane_count">{{
        totalCount ?? 0
      }}</span
      >)
    </div>
    <span id="count_aircraft">visible aircraft</span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const totalCount = computed(
  () => tangramApi.state.totalCounts.value?.get("jet1090_aircraft") ?? 0
);

const visibleCount = computed(
  () => tangramApi.state.getEntitiesByType("jet1090_aircraft").value?.size ?? 0
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
.aircraft-count-widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1px;
  border-bottom: 1px solid #ddd;
}
.count-display {
  text-align: center;
}
</style>
