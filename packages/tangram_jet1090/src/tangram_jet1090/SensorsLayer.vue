<script setup lang="ts">
import { inject, onUnmounted, ref, watch, reactive, type Ref } from "vue";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import type { PickingInfo } from "@deck.gl/core";

interface Sensor {
  position: [number, number];
  name: string;
  aircraft_count: number;
}

interface RawSensorResponse {
  reference?: {
    latitude: number;
    longitude: number;
  };
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

    fetch("/jet1090/sensors")
      .then(response => {
        if (!response.ok) {
          console.warn(`sensors endpoint returned ${response}`);
          return {};
        }
        return response.json();
      })
      .then(sensors => {
        if (!sensors || typeof sensors !== "object") return;

        const sensorData: Sensor[] = Object.values(sensors).map((sensor: unknown) => {
          const s = sensor as RawSensorResponse;
          return {
            position: [s?.reference?.longitude || 0, s?.reference?.latitude || 0],
            name: s.name,
            aircraft_count: s.aircraft_count
          };
        });

        const sensorsLayer = new ScatterplotLayer<Sensor>({
          id: "sensors-layer",
          data: sensorData.filter(sensor => sensor.aircraft_count > 0),
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
  border-radius: 10px;
  font-size: 12px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(10px, -10px);
  z-index: 10;
}
</style>
