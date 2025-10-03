<script setup lang="ts">
import { inject, onUnmounted, ref, watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";
import * as L from "leaflet";
import { html, render } from "lit-html";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}
const geoJsonLayer = ref<L.GeoJSON | null>(null);

const createTooltipTemplate = (name: string, aircraft_count: number) => {
  return html`<b>${name}</b><br />${aircraft_count} aircraft`;
};

const stopWatch = watch(
  () => tangramApi.map.isReady.value,
  isReady => {
    if (!isReady) {
      return;
    }

    const map = tangramApi.map.getMapInstance();

    fetch("/sensors")
      .then(response => {
        if (!response.ok) {
          throw new Error("network response was not ok");
        }
        return response.json();
      })
      .then(sensors => {
        const geoJsonData = {
          type: "FeatureCollection",
          features: Object.values(sensors)
            // .filter((sensor: any) => sensor.aircraft_count > 0)
            .map((sensor: any) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [sensor.reference.longitude, sensor.reference.latitude]
              },
              properties: {
                name: sensor.name,
                aircraft_count: sensor.aircraft_count
              }
            }))
        };

        if (geoJsonLayer.value) {
          geoJsonLayer.value.remove();
        }

        geoJsonLayer.value = L.geoJSON(geoJsonData as any, {
          onEachFeature: (feature, layer) => {
            if (feature.properties?.name) {
              const tooltipContainer = document.createElement("div");
              render(
                createTooltipTemplate(
                  feature.properties.name,
                  feature.properties.aircraft_count
                ),
                tooltipContainer
              );
              layer.bindTooltip(tooltipContainer);
            }
          }
        }).addTo(map);
      })
      .catch(error => {
        console.error("failed to fetch or display sensor data:", error);
      });

    stopWatch();
  },
  { immediate: true }
);

onUnmounted(() => {
  if (geoJsonLayer.value) {
    geoJsonLayer.value.remove();
  }
});
</script>
