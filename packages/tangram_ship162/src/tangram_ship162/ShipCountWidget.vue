<template>
  <div class="ship-count-widget">
    <div class="count-display">
      <span id="visible_ships_count">{{ visibleCount }}</span> (<span>{{
        totalCount ?? 0
      }}</span
      >)
    </div>
    <span id="count_ships">visible ships</span>
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
  () => tangramApi.state.totalCounts.value?.get("ship162_ship") ?? 0
);
const visibleCount = computed(
  () => tangramApi.state.getEntitiesByType("ship162_ship").value?.size ?? 0
);
</script>

<style scoped>
#visible_ships_count {
  font-size: 1em;
  color: #4c78a8;
}
#count_ships {
  color: #79706e;
  font-size: 9pt;
  text-align: center;
}
.ship-count-widget {
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
