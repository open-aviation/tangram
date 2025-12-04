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
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram-core/api";
import Raphael from "raphael";
import { html, svg, render } from "lit-html";
import { get_image_object, type IconProps } from "./PlanePath";
import type { Jet1090Aircraft } from ".";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const aircraftEntities = computed(
  () => tangramApi.state.getEntitiesByType<Jet1090Aircraft>("jet1090_aircraft").value
);
const activeEntity = computed(() => tangramApi.state.activeEntity.value);
const baseLayerDisposable: Ref<Disposable | null> = ref(null);
const selectedLayerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<Jet1090Aircraft> | null;
}>({ x: 0, y: 0, object: null });

const iconCache = new Map<string, string>();

const createAircraftSvgDataURL = (typecode: string, isSelected: boolean): string => {
  const cacheKey = `${typecode}-${isSelected}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const iconProps = get_image_object(typecode) as IconProps;
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
    width="64px"
    height="64px"
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

const commonLayerProps = {
  pickable: true,
  billboard: false,
  sizeScale: 1,
  getSize: 32,
  onClick: (info: PickingInfo<Entity<Jet1090Aircraft>>) => {
    if (info.object) {
      tangramApi.state.setActiveEntity(info.object);
    }
  },
  onHover: (info: PickingInfo<Entity<Jet1090Aircraft>>) => {
    if (info.object) {
      tooltip.object = info.object;
      tooltip.x = info.x;
      tooltip.y = info.y;
    } else {
      tooltip.object = null;
    }
  }
};

watch(
  [aircraftEntities, activeEntity, () => tangramApi.map.isReady.value],
  ([entities, currentActiveEntity, isMapReady]) => {
    if (!entities || !isMapReady) return;

    const allAircraft = Array.from(entities.values());
    const selectedId = currentActiveEntity?.id;

    // split data to prevent global atlas invalidation
    const baseData = selectedId
      ? allAircraft.filter(d => d.id !== selectedId)
      : allAircraft;
    const selectedData = selectedId ? allAircraft.filter(d => d.id === selectedId) : [];

    const baseLayer = new IconLayer<Entity<Jet1090Aircraft>>({
      ...commonLayerProps,
      id: "aircraft-layer-base",
      data: baseData,
      getIcon: d => ({
        url: createAircraftSvgDataURL(d.state.typecode || "A320", false), // Fallback if typecode missing
        width: 64,
        height: 64,
        anchorY: 32
      }),
      getPosition: d => [d.state.longitude!, d.state.latitude!], // Validated by upstream filter usually, but assert for TS
      getAngle: (d: Entity<Jet1090Aircraft>) => {
        const iconProps = get_image_object(d.state.typecode || null) as IconProps;
        return -(d.state.track || 0) + iconProps.rotcorr;
      }
      // no updateTriggers needed, icon depends only on typecode which is stable.
    });

    const selectedLayer = new IconLayer<Entity<Jet1090Aircraft>>({
      ...commonLayerProps,
      id: "aircraft-layer-selected",
      data: selectedData,
      getIcon: d => ({
        url: createAircraftSvgDataURL(d.state.typecode || "A320", true),
        width: 64,
        height: 64,
        anchorY: 32
      }),
      getPosition: d => [d.state.longitude!, d.state.latitude!],
      getAngle: (d: Entity<Jet1090Aircraft>) => {
        const iconProps = get_image_object(d.state.typecode || null) as IconProps;
        return -(d.state.track || 0) + iconProps.rotcorr;
      }
    });

    const d1 = tangramApi.map.setLayer(baseLayer);
    if (!baseLayerDisposable.value) baseLayerDisposable.value = d1;

    const d2 = tangramApi.map.setLayer(selectedLayer);
    if (!selectedLayerDisposable.value) selectedLayerDisposable.value = d2;
  },
  { immediate: true }
);

onUnmounted(() => {
  baseLayerDisposable.value?.dispose();
  selectedLayerDisposable.value?.dispose();
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
