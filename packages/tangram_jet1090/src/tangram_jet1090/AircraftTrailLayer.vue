<script setup lang="ts">
import { inject, onUnmounted, watch } from "vue";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { oklchToDeckGLColor } from "@open-aviation/tangram-core/colour";
import { aircraftStore, pluginConfig } from "./store";
import type { Layer } from "@deck.gl/core";
import type { Jet1090Aircraft } from ".";

const FEET_TO_METERS = 0.3048;
const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();

type Color = [number, number, number, number];

function hexToRgb(hex: string): Color {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255]
    : [128, 0, 128, 255];
}

function getPointColor(p: Jet1090Aircraft): Color {
  const { trailColor, trailAlpha } = pluginConfig;
  const a = Math.round(trailAlpha * 255);

  if (typeof trailColor === "string") {
    const rgb = hexToRgb(trailColor);
    return [rgb[0], rgb[1], rgb[2], a];
  }

  const { by_attribute, min, max } = trailColor;
  let value = 0;
  let rangeMin = min ?? 0;
  let rangeMax = max ?? 1;
  let hueMin = 0;
  let hueMax = 0;

  if (by_attribute === "altitude") {
    value = p.altitude || 0;
    rangeMin = min ?? 0;
    rangeMax = max ?? 45000;
    hueMin = 270;
    hueMax = 0;
  } else if (by_attribute === "groundspeed") {
    value = p.groundspeed || 0;
    rangeMin = min ?? 0;
    rangeMax = max ?? 600;
    hueMin = 240;
    hueMax = 0;
  } else if (by_attribute === "vertical_rate") {
    value = p.vertical_rate || 0;
    if (Math.abs(value) < 100) return [128, 128, 128, a];
    const intensity = Math.min(1, Math.abs(value) / (max ?? 2000));
    if (value > 0) {
      return oklchToDeckGLColor(0.6 + intensity * 0.2, 0.1 + intensity * 0.15, 260, a);
    } else {
      return oklchToDeckGLColor(0.6 + intensity * 0.1, 0.1 + intensity * 0.15, 30, a);
    }
  } else if (by_attribute === "track") {
    value = p.track || p.heading || 0;
    return oklchToDeckGLColor(0.65, 0.2, value, a);
  }

  // lerp for other modes (altitude, groundspeed)
  const t = Math.max(0, Math.min(1, (value - rangeMin) / (rangeMax - rangeMin)));
  const h = hueMin + t * (hueMax - hueMin);
  return oklchToDeckGLColor(0.65, 0.2, h, a);
}

const updateLayer = () => {
  const layers: Layer[] = [];
  const pathData: { path: number[][]; colors: Color[] }[] = [];
  const curtainData: { polygon: number[][]; color: Color }[] = [];

  for (const [, data] of aircraftStore.selected) {
    const traj = data.trajectory;
    if (traj.length < 2) continue;

    const pathPoints: number[][] = [];
    const pathColors: Color[] = [];

    let prevAlt: number | null = null;

    for (let i = 0; i < traj.length; i++) {
      const p = traj[i];
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;

      let alt = p.altitude;
      if (alt == null && prevAlt != null) {
        alt = prevAlt;
      }
      if (alt != null) prevAlt = alt;

      const z = !tangramApi.config.map.enable_3d ? 0 : (alt || 0) * FEET_TO_METERS;
      const point = [p.longitude!, p.latitude!, z];
      const color = getPointColor(p);

      pathPoints.push(point);
      pathColors.push(color);

      if (pluginConfig.trailType === "curtain" && pathPoints.length >= 2) {
        const [lon1, lat1, z1] = pathPoints[pathPoints.length - 2];
        const [lon2, lat2, z2] = point;

        curtainData.push({
          polygon: [
            [lon1, lat1, 0],
            [lon2, lat2, 0],
            [lon2, lat2, z2],
            [lon1, lat1, z1]
          ],
          color
        });
      }
    }

    if (pathPoints.length > 1) {
      pathData.push({
        path: pathPoints,
        colors: pathColors
      });
    }
  }

  if (pathData.length > 0) {
    layers.push(
      new PathLayer({
        id: `jet1090-trails-path`,
        data: pathData,
        pickable: false,
        widthScale: 1,
        widthMinPixels: 2,
        getPath: d => d.path,
        getColor: d => d.colors,
        getWidth: 2
      })
    );
  }

  if (curtainData.length > 0) {
    layers.push(
      new SolidPolygonLayer({
        id: `jet1090-curtains-poly`,
        data: curtainData,
        pickable: false,
        stroked: false,
        filled: true,
        extruded: false,
        _full3d: true,
        getPolygon: d => d.polygon,
        getFillColor: d => d.color
      })
    );
  }

  const currentIds = new Set(layers.map(l => l.id));

  for (const [id, disposable] of layerDisposables) {
    if (!currentIds.has(id)) {
      disposable.dispose();
      layerDisposables.delete(id);
    }
  }

  for (const layer of layers) {
    if (!layerDisposables.has(layer.id)) {
      layerDisposables.set(layer.id, tangramApi.map.setLayer(layer));
    } else {
      tangramApi.map.setLayer(layer);
    }
  }
};

watch(
  [
    () => aircraftStore.version,
    () => pluginConfig.trailType,
    () => pluginConfig.trailColor,
    () => pluginConfig.trailAlpha
  ],
  updateLayer,
  { deep: true }
);

onUnmounted(() => {
  layerDisposables.forEach(d => d.dispose());
  layerDisposables.clear();
});
</script>
