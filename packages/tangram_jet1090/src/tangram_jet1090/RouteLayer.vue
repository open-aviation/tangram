<script setup lang="ts">
import { inject, onUnmounted, ref, watch, type Ref } from "vue";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { aircraftStore, pluginConfig } from "./store";
import type { Layer } from "@deck.gl/core";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposable: Ref<Disposable | null> = ref(null);

const greatCircleCache = new Map<string, [number, number][]>();

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function getGreatCirclePath(
  start: [number, number, number?],
  end: [number, number, number?],
  numPoints = 40
): [number, number, number][] {
  const key = `${start[0]},${start[1]}-${end[0]},${end[1]}`;

  const startAlt = !tangramApi.config.map.enable_3d ? 0 : start[2] || 0;
  const endAlt = !tangramApi.config.map.enable_3d ? 0 : end[2] || 0;

  let flatPath: [number, number][] = [];

  if (greatCircleCache.has(key)) {
    flatPath = greatCircleCache.get(key)!;
  } else {
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

    if (d < 1e-6) {
      flatPath = [
        [start[0], start[1]],
        [end[0], end[1]]
      ];
    } else {
      flatPath = [];
      const sinD = Math.sin(d);
      for (let i = 0; i <= numPoints; i++) {
        const f = i / numPoints;
        const A = Math.sin((1 - f) * d) / sinD;
        const B = Math.sin(f * d) / sinD;
        const x =
          A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
        const y =
          A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
        const z = A * Math.sin(lat1) + B * Math.sin(lat2);
        const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
        const lon = Math.atan2(y, x);
        flatPath.push([toDeg(lon), toDeg(lat)]);
      }
    }
    greatCircleCache.set(key, flatPath);
  }

  const path: [number, number, number][] = [];
  for (let i = 0; i < flatPath.length; i++) {
    const f = i / (flatPath.length - 1 || 1);
    const alt = startAlt + (endAlt - startAlt) * f;
    path.push([flatPath[i][0], flatPath[i][1], alt]);
  }
  return path;
}

const updateLayer = () => {
  if (!pluginConfig.showRouteLines) {
    if (layerDisposable.value) {
      layerDisposable.value.dispose();
      layerDisposable.value = null;
    }
    return;
  }

  const paths: Array<{
    path: [number, number, number][];
    color: [number, number, number, number];
  }> = [];

  for (const [id, data] of aircraftStore.selected) {
    const entity = tangramApi.state.getEntitiesByType("jet1090_aircraft").value.get(id);
    if (!entity) continue;
    const state = entity.state as {
      longitude?: number;
      latitude?: number;
      altitude?: number;
    };
    if (state.longitude == null || state.latitude == null) continue;

    const currentPos: [number, number, number] = [
      state.longitude,
      state.latitude,
      !tangramApi.config.map.enable_3d ? 0 : (state.altitude || 0) * 0.3048
    ];

    const firstPoint = data.trajectory.find(
      p => p.latitude != null && p.longitude != null
    );

    // 1. static: origin -> first point (great circle)
    if (
      data.route.origin?.lat != null &&
      data.route.origin?.lon != null &&
      firstPoint
    ) {
      const originPos: [number, number, number] = [
        data.route.origin.lon,
        data.route.origin.lat,
        0
      ];
      const firstPos: [number, number, number] = [
        firstPoint.longitude!,
        firstPoint.latitude!,
        !tangramApi.config.map.enable_3d ? 0 : (firstPoint.altitude || 0) * 0.3048
      ];
      paths.push({
        path: getGreatCirclePath(originPos, firstPos),
        color: [128, 128, 128, 128]
      });
    }

    // 2. current -> destination (great circle)
    if (data.route.destination?.lat != null && data.route.destination?.lon != null) {
      const destPos: [number, number, number] = [
        data.route.destination.lon,
        data.route.destination.lat,
        0
      ];

      paths.push({
        path: getGreatCirclePath(currentPos, destPos),
        color: [128, 128, 128, 128]
      });
    }
  }

  if (paths.length > 0) {
    const routeLayer = new PathLayer({
      id: "jet1090-routes",
      data: paths,
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      getPath: d => d.path,
      getColor: d => d.color,
      getWidth: 2,
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: [10, 10],
      dashJustified: true
    }) as Layer;

    if (!layerDisposable.value) {
      layerDisposable.value = tangramApi.map.setLayer(routeLayer);
    } else {
      tangramApi.map.setLayer(routeLayer);
    }
  } else if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }
};

watch([() => aircraftStore.version, () => pluginConfig.showRouteLines], updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
