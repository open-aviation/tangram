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
  start: [number, number],
  end: [number, number],
  numPoints = 40
): [number, number][] {
  const key = `${start.join(",")}-${end.join(",")}`;
  if (greatCircleCache.has(key)) return greatCircleCache.get(key)!;

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

  let path: [number, number][];
  if (d < 1e-6) {
    path = [start, end];
  } else {
    path = [];
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
      path.push([toDeg(lon), toDeg(lat)]);
    }
  }
  greatCircleCache.set(key, path);
  return path;
}

const updateLayer = () => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  if (!pluginConfig.showRouteLines) return;

  const paths: Array<{
    path: [number, number][];
    color: [number, number, number, number];
  }> = [];

  for (const [id, data] of aircraftStore.selected) {
    const entity = tangramApi.state.getEntitiesByType("jet1090_aircraft").value.get(id);
    if (!entity) continue;
    const state = entity.state as { longitude?: number; latitude?: number };
    if (state.longitude == null || state.latitude == null) continue;

    const currentPos = [state.longitude, state.latitude] as [number, number];
    const firstPoint = data.trajectory.find(
      p => p.latitude != null && p.longitude != null
    );

    // 1. static: origin -> first point (great circle)
    if (
      data.route.origin?.lat != null &&
      data.route.origin?.lon != null &&
      firstPoint
    ) {
      const originPos: [number, number] = [
        data.route.origin.lon,
        data.route.origin.lat
      ];
      const firstPos: [number, number] = [firstPoint.longitude!, firstPoint.latitude!];
      paths.push({
        path: getGreatCirclePath(originPos, firstPos),
        color: [128, 128, 128, 128]
      });
    }

    // 2. ghost point -> destination (great circle) & current -> ghost (straight)
    if (data.route.destination?.lat != null && data.route.destination?.lon != null) {
      const destPos: [number, number] = [
        data.route.destination.lon,
        data.route.destination.lat
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
    layerDisposable.value = tangramApi.map.setLayer(routeLayer);
  }
};

watch([() => aircraftStore.version, () => pluginConfig.showRouteLines], updateLayer);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>
