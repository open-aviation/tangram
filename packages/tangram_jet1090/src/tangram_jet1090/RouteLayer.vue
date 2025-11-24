<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram/api";
import { selectedAircraft } from "./store";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

const updateLayer = () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  const entity = activeEntity.value;
  if (entity?.type === "jet1090_aircraft" && selectedAircraft.icao24 === entity.id) {
    const state = entity.state as any;
    if (state.longitude == null || state.latitude == null) return;

    const currentPos = [state.longitude, state.latitude];
    const trajectory = selectedAircraft.trajectory;
    const firstPoint = trajectory.find(p => p.latitude != null && p.longitude != null);
    const paths = [];

    if (
      selectedAircraft.route.origin &&
      selectedAircraft.route.origin.lat !== null &&
      selectedAircraft.route.origin.lon !== null &&
      firstPoint
    ) {
      paths.push({
        path: [
          [selectedAircraft.route.origin.lon, selectedAircraft.route.origin.lat],
          [firstPoint.longitude, firstPoint.latitude]
        ],
        color: [128, 128, 128, 128],
        dash: true
      });
    }

    if (
      selectedAircraft.route.destination &&
      selectedAircraft.route.destination.lat !== null &&
      selectedAircraft.route.destination.lon !== null
    ) {
      paths.push({
        path: [
          currentPos,
          [
            selectedAircraft.route.destination.lon,
            selectedAircraft.route.destination.lat
          ]
        ],
        color: [128, 128, 128, 128],
        dash: true
      });
    }

    if (paths.length > 0) {
      const routeLayer = new PathLayer({
        id: `route-layer-${entity.id}`,
        data: paths,
        pickable: false,
        widthScale: 1,
        widthMinPixels: 1,
        getPath: d => d.path,
        getColor: d => d.color,
        getWidth: 1,
        getDashArray: [10, 10],
        dashJustified: true,
        extensions: [new PathStyleExtension({ dash: true })]
      });
      layerDisposable.value = tangramApi.map.addLayer(routeLayer);
    }
  }
};

watch(
  () => [
    selectedAircraft.route.origin,
    selectedAircraft.route.destination,
    activeEntity.value?.state,
    selectedAircraft.trajectory.length // for connecting to destination
  ],
  updateLayer,
  { deep: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
