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
const activeEntities = computed(() => tangramApi.state.activeEntities.value);
const layerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<Jet1090Aircraft> | null;
}>({ x: 0, y: 0, object: null });

const iconCache = new Map<string, string>();
const bboxCache = new Map<string, DOMRect>();

const getPathBBox = (d: string): DOMRect => {
  if (bboxCache.has(d)) return bboxCache.get(d)!;
  const svgNS = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(svgNS, "svg");
  svgEl.style.cssText = "position:absolute;visibility:hidden;width:0;height:0";
  const pathEl = document.createElementNS(svgNS, "path");
  pathEl.setAttribute("d", d);
  svgEl.appendChild(pathEl);
  document.body.appendChild(svgEl);
  const bbox = pathEl.getBBox();
  document.body.removeChild(svgEl);
  bboxCache.set(d, bbox);
  return bbox;
};

const createAircraftSvgDataURL = (typecode: string, isSelected: boolean): string => {
  const cacheKey = `${typecode}-${isSelected}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const iconProps = get_image_object(typecode) as IconProps;
  const bbox = getPathBBox(iconProps.path);
  const centerX = bbox.x + bbox.width / 2.0;
  const centerY = bbox.y + bbox.height / 2.0;
  const offsetX = iconProps.ofX || 0;
  const offsetY = iconProps.ofY || 0;
  const scale = iconProps.scale * 0.7;

  const tx = -centerX + offsetX;
  const ty = -centerY + offsetY;
  const strokeWidth = 0.65 / scale;

  const fillColor = isSelected ? "#ff6464" : "#f9fd15";
  const transform = `scale(${scale}) translate(${tx}, ${ty})`;

  const path = svg`<path stroke="#0014aa" fill="${fillColor}" stroke-width="${strokeWidth}" d="${iconProps.path}" transform="${transform}"/>`;
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

const onClick = (
  info: PickingInfo<Entity<Jet1090Aircraft>>,
  event: { srcEvent: { originalEvent: MouseEvent } }
) => {
  if (!info.object) return;
  const srcEvent = event.srcEvent.originalEvent;
  const exclusive = !srcEvent.ctrlKey && !srcEvent.altKey && !srcEvent.metaKey;

  if (exclusive) {
    tangramApi.state.selectEntity(info.object, true);
  } else {
    if (tangramApi.state.activeEntities.value.has(info.object.id)) {
      tangramApi.state.deselectEntity(info.object.id);
    } else {
      tangramApi.state.selectEntity(info.object, false);
    }
  }
};

watch(
  [aircraftEntities, activeEntities, () => tangramApi.map.isReady.value],
  ([entities, currentActiveEntities, isMapReady]) => {
    if (!entities || !isMapReady) return;

    const baseData = [];
    const selectedData = [];
    for (const d of entities.values()) {
      if (currentActiveEntities.has(d.id)) {
        selectedData.push(d);
      } else {
        baseData.push(d);
      }
    }
    const data = baseData.concat(selectedData);

    const layer = new IconLayer<Entity<Jet1090Aircraft>>({
      id: "aircraft-layer",
      data: data,
      pickable: true,
      billboard: false,
      sizeScale: 1,
      getSize: 32,
      getIcon: d => {
        const typecode = d.state.typecode || "A320";
        const isSelected = currentActiveEntities.has(d.id);
        const iconId = `${typecode}-${isSelected}`;
        return {
          url: createAircraftSvgDataURL(typecode, isSelected),
          id: iconId,
          width: 64,
          height: 64,
          anchorY: 32,
          mask: false
        };
      },
      getPosition: d => [d.state.longitude!, d.state.latitude!],
      getAngle: (d: Entity<Jet1090Aircraft>) => {
        const iconProps = get_image_object(d.state.typecode || null) as IconProps;
        return -(d.state.track || 0) + iconProps.rotcorr;
      },
      onClick: onClick,
      onHover: (info: PickingInfo<Entity<Jet1090Aircraft>>) => {
        if (info.object) {
          tooltip.object = info.object;
          tooltip.x = info.x;
          tooltip.y = info.y;
        } else {
          tooltip.object = null;
        }
      },
      updateTriggers: {
        getIcon: Array.from(currentActiveEntities.keys()).sort().join(",")
      },
      // required for globe: https://github.com/visgl/deck.gl/issues/9777#issuecomment-3628393899
      parameters: {
        cullMode: "none"
      }
    });

    const d = tangramApi.map.setLayer(layer);
    if (!layerDisposable.value) layerDisposable.value = d;
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
  border-radius: 10px;
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
