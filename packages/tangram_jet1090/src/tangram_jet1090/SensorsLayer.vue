<script setup lang="ts">
import { inject, onUnmounted, ref, watch, reactive, type Ref } from "vue";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram/api";
import type { PickingInfo } from "@deck.gl/core";

interface Sensor {
  position: [number, number];
  name: string;
  aircraft_count: number;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const layerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Sensor | null;
}>({ x: 0, y: 0, object: null });

watch(
  () => tangramApi.map.isReady.value,
  isReady => {
    if (!isReady) return;

    fetch("/sensors")
      .then(response => {
        if (!response.ok) throw new Error("network response was not ok");
        return response.json();
      })
      .then(sensors => {
        const sensorData: Sensor[] = Object.values(sensors).map((sensor: any) => ({
          position: [sensor.reference.longitude, sensor.reference.latitude],
          name: sensor.name,
          aircraft_count: sensor.aircraft_count
        }));

        const sensorsLayer = new ScatterplotLayer<Sensor>({
          id: "sensors-layer",
          data: sensorData,
          pickable: true,
          stroked: true,
          filled: true,
          radiusMinPixels: 5,
          radiusMaxPixels: 20,
          lineWidthMinPixels: 1,
          getPosition: d => d.position,
          getFillColor: [51, 136, 255, 255] /* blue */,
          getLineColor: [255, 255, 255, 255] /* white */,
          onHover: (info: PickingInfo<Sensor>) => {
            if (info.object) {
              tooltip.object = info.object;
              tooltip.x = info.x;
              tooltip.y = info.y;
            } else {
              tooltip.object = null;
            }
          }
        });

        if (layerDisposable.value) layerDisposable.value.dispose();
        layerDisposable.value = tangramApi.map.addLayer(sensorsLayer);
      })
      .catch(error => {
        console.error("failed to fetch or display sensor data:", error);
      });
  },
  { immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>

<template>
  <div
    v-if="tooltip.object"
    class="deck-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <b>{{ tooltip.object.name }}</b>
    <br />
    {{ tooltip.object.aircraft_count }} aircraft
  </div>
</template>

<style>
.deck-tooltip {
  position: absolute;
  background: white;
  color: black;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(10px, -10px);
  z-index: 10;
}
</style>
