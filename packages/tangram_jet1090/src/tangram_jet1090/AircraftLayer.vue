<template>
  <div
    v-if="tooltip.object"
    class="deck-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <div class="tooltip-grid">
      <div class="callsign">{{ tooltip.object.state.callsign }}</div>
      <div class="typecode">{{ tooltip.object.state.typecode }}</div>
      <div class="registration">{{ tooltip.object.state.registration }}</div>
      <div class="icao24">{{ tooltip.object.state.icao24 }}</div>
      <div v-if="tooltip.object.state.altitude > 0" class="altitude">
        FL{{ Math.round(tooltip.object.state.altitude / 1000) * 10 }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, reactive, type Ref } from "vue";
import { IconLayer } from "@deck.gl/layers";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram/api";
import Raphael from "raphael";
import { html, svg, render } from "lit-html";
import { get_image_object } from "./PlanePath";

export interface AircraftState {
  latitude: number;
  longitude: number;
  typecode: string;
  callsign: string;
  track: number;
  icao24: string;
  registration: string;
  altitude: number;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const aircraftEntities = computed(
  () => tangramApi.state.getEntitiesByType<AircraftState>("jet1090_aircraft").value
);
const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<AircraftState> | null;
}>({ x: 0, y: 0, object: null });

const iconCache = new Map<string, string>();

const createAircraftSvgDataURL = (typecode: string, isSelected: boolean): string => {
  const cacheKey = `${typecode}-${isSelected}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const iconProps = get_image_object(typecode);
  const bbox = Raphael.pathBBox(iconProps.path);
  const centerX = Math.floor(bbox.x + bbox.width / 2.0);
  const centerY = Math.floor(bbox.y + bbox.height / 2.0);
  const offsetX = iconProps.ofX || 0;
  const offsetY = iconProps.ofY || 0;
  const transform = `T${-1 * centerX + offsetX},${
    -1 * centerY + offsetY
  }S${iconProps.scale * 0.7}`;
  const transformedPath = Raphael.mapPath(
    iconProps.path,
    Raphael.toMatrix(iconProps.path, transform)
  );

  const fillColor = isSelected ? "#ff6464" : "#f9fd15";
  const path = svg`<path stroke="#0014aa" fill="${fillColor}" stroke-width="0.65" d="${transformedPath}"/>`;
  const template = html`<svg
    version="1.1"
    shape-rendering="geometricPrecision"
    width="32px"
    height="32px"
    viewBox="-16 -16 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    ${path}
  </svg>`;
  const container = document.createElement("div");
  render(template, container);

  const svgString = container.innerHTML;
  const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`;
  iconCache.set(cacheKey, dataUrl);
  return dataUrl;
};

watch(
  [aircraftEntities, activeEntity, () => tangramApi.map.isReady.value],
  ([entities, currentActiveEntity, isMapReady]) => {
    if (!entities || !isMapReady) return;

    if (layerDisposable.value) {
      layerDisposable.value.dispose();
    }

    const aircraftLayer = new IconLayer<Entity<AircraftState>>({
      id: "aircraft-layer",
      data: Array.from(entities.values()),
      pickable: true,
      billboard: false,
      getIcon: d => ({
        url: createAircraftSvgDataURL(d.state.typecode, d.id === currentActiveEntity?.id),
        width: 32,
        height: 32,
        anchorY: 16
      }),
      sizeScale: 1,
      getPosition: d => [d.state.longitude, d.state.latitude],
      getSize: 32,
      getAngle: d => {
        const iconProps = get_image_object(d.state.typecode);
        return -d.state.track + iconProps.rotcorr;
      },
      onClick: ({ object }) => {
        if (object) {
          tangramApi.state.setActiveEntity(object);
        }
      },
      onHover: info => {
        if (info.object) {
          tooltip.object = info.object;
          tooltip.x = info.x;
          tooltip.y = info.y;
        } else {
          tooltip.object = null;
        }
      },
      updateTriggers: {
        getIcon: [currentActiveEntity?.id]
      }
    });

    layerDisposable.value = tangramApi.map.addLayer(aircraftLayer);
  },
  { immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
});
</script>

<style>
.deck-tooltip {
  position: absolute;
  background: white;
  color: black;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(10px, -20px);
  z-index: 10;
  min-width: 120px;
}
.tooltip-grid {
  border-radius: 10px;
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.5rem;
  font-size: 11px;
  min-width: 120px;
}

.callsign {
  font-weight: bold;
  font-size: 1.1em;
}

.typecode,
.icao24 {
  text-align: right;
}

.altitude {
  grid-column: 1 / -1;
  margin-top: 2px;
}
</style>
