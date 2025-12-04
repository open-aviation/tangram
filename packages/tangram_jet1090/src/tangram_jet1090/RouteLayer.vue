<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { selectedAircraft, pluginConfig } from "./store";
import type { AircraftState } from "./AircraftLayer.vue";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

const staticOriginCache = ref<{ key: string; path: [number, number][] } | null>(null);
const staticDestCache = ref<{ key: string; path: [number, number][] } | null>(null);
const ghostPoint = ref<[number, number] | null>(null);

// switching aircraft
watch(
  () => selectedAircraft.icao24,
  () => {
    staticOriginCache.value = null;
    staticDestCache.value = null;
    ghostPoint.value = null;
  }
);

// destination change: clear ghost point
watch(
  () => [
    selectedAircraft.route.destination?.lat,
    selectedAircraft.route.destination?.lon
  ],
  () => {
    staticDestCache.value = null;
    ghostPoint.value = null;
  }
);

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function getGreatCirclePath(
  start: [number, number],
  end: [number, number],
  numPoints = 40
): [number, number][] {
  const lat1 = toRad(start[1]);
  const lon1 = toRad(start[0]);
  const lat2 = toRad(end[1]);
  const lon2 = toRad(end[0]);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin((lat1 - lat2) / 2), 2) +
          Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon1 - lon2) / 2), 2)
      )
    );

  if (d < 1e-6) return [start, end];

  const path: [number, number][] = [];
  const sinD = Math.sin(d);

  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    path.push([toDeg(lon), toDeg(lat)]);
  }
  return path;
}

const updateLayer = () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  if (!pluginConfig.showRouteLines) return;

  const entity = activeEntity.value;
  if (entity?.type === "jet1090_aircraft" && selectedAircraft.icao24 === entity.id) {
    const state = entity.state as AircraftState;
    if (state.longitude == null || state.latitude == null) return;

    const currentPos = [state.longitude, state.latitude] as [number, number];
    const trajectory = selectedAircraft.trajectory;
    const firstPoint = trajectory.find(p => p.latitude != null && p.longitude != null);
    const paths = [];

    // 1. static: origin -> first point (great circle)
    if (
      selectedAircraft.route.origin?.lat != null &&
      selectedAircraft.route.origin?.lon != null &&
      firstPoint
    ) {
      const originKey = `${selectedAircraft.route.origin.lon},${selectedAircraft.route.origin.lat}-${firstPoint.longitude},${firstPoint.latitude}`;
      if (staticOriginCache.value?.key !== originKey) {
        staticOriginCache.value = {
          key: originKey,
          path: getGreatCirclePath(
            [selectedAircraft.route.origin.lon, selectedAircraft.route.origin.lat],
            [firstPoint.longitude, firstPoint.latitude]
          )
        };
      }
      paths.push({
        path: staticOriginCache.value.path,
        color: [128, 128, 128, 128]
      });
    }

    if (
      selectedAircraft.route.destination?.lat != null &&
      selectedAircraft.route.destination?.lon != null
    ) {
      if (!ghostPoint.value) {
        ghostPoint.value = currentPos;
      }

      // 2a. static: ghost point -> destination (great circle)
      const destKey = `${ghostPoint.value[0]},${ghostPoint.value[1]}-${selectedAircraft.route.destination.lon},${selectedAircraft.route.destination.lat}`;
      if (staticDestCache.value?.key !== destKey) {
        staticDestCache.value = {
          key: destKey,
          path: getGreatCirclePath(ghostPoint.value, [
            selectedAircraft.route.destination.lon,
            selectedAircraft.route.destination.lat
          ])
        };
      }
      paths.push({
        path: staticDestCache.value.path,
        color: [128, 128, 128, 128]
      });

      // 2b. dynamic: current position -> ghost point (straight line)
      paths.push({
        path: [currentPos, ghostPoint.value],
        color: [128, 128, 128, 128]
      });
    }

    if (paths.length > 0) {
      const routeLayer = new PathLayer({
        id: `route-layer-${entity.id}`,
        data: paths,
        pickable: false,
        widthScale: 1,
        widthMinPixels: 2,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: (d: { color: [number, number, number, number] }) => d.color,
        getWidth: 2,
        extensions: [new PathStyleExtension({ dash: true })],
        getDashArray: [10, 10],
        dashJustified: true
      });
      const disposable = tangramApi.map.setLayer(routeLayer);
      if (!layerDisposable.value) {
        layerDisposable.value = disposable;
      }
    }
  }
};

watch(
  () => [
    (activeEntity.value?.state as AircraftState | undefined)?.latitude,
    (activeEntity.value?.state as AircraftState | undefined)?.longitude,
    pluginConfig.showRouteLines,
    selectedAircraft.route.origin,
    selectedAircraft.route.destination,
    selectedAircraft.trajectory.length > 0
      ? selectedAircraft.trajectory[0].timestamp
      : 0
  ],
  updateLayer
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
