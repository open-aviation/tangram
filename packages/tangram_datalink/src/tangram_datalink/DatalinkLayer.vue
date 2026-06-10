<script setup lang="ts">
import { inject, watch, onUnmounted, ref, reactive, type Ref } from "vue";
import { IconLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable, Entity } from "@open-aviation/tangram-core/api";
import type { PickingInfo } from "@deck.gl/core";
import { getModifierKeys } from "@open-aviation/tangram-core/utils";
import { html, svg, render } from "lit-html";
import { ENTITY_TYPE, type DatalinkEntity } from "./index";
import { airportName } from "./airport";
import { datalinkStore } from "./store";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposable: Ref<Disposable | null> = ref(null);
const tooltip = reactive({
  x: 0,
  y: 0,
  object: null as Entity<DatalinkEntity> | null
});

// stealing from jet1090 and hardcoding until we find a reliable way to determine the aircraft type
const A320_PATH =
  "M12,28 13,26 14,23 14,18 16,17 16,19 18,19 18,16 24,11 24,10 23,10 15,13 14,13 13,6 13,5 16,2 16,0 13,2 12,0 11,2 8,0 8,2 11,5 11,6 10,13 9,13 1,10 0,10 0,11 6,16 6,19 8,19 8,17 10,18 10,23 11,26 12,28z";
const STATION_PATH =
  "M12,28 14,28 14,12 18,21 20,21 15,9 15,5 17,3 14,0 11,3 13,5 13,9 8,21 10,21 12,12z M7,17 4,14 4,10 7,7 8,9 6,11 6,13 9,16z M21,16 24,13 24,10 21,7 20,9 22,11 22,13 19,16z";

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

const createIcon = (kind: "aircraft" | "station", isSelected: boolean) => {
  const iconPath = kind === "station" ? STATION_PATH : A320_PATH;
  const scale = kind === "station" ? 0.85 : 0.75;
  const ofX = kind === "station" ? 0 : -0.4;
  const ofY = kind === "station" ? 0 : -0.9;
  const bbox = getPathBBox(iconPath);
  const centerX = bbox.x + bbox.width / 2.0;
  const centerY = bbox.y + bbox.height / 2.0;

  const tx = -centerX + ofX;
  const ty = -centerY + ofY;
  const strokeWidth = 0.65 / scale;

  const fillColor = isSelected ? "#ff6464" : "#f9fd15";
  const transform = `scale(${scale}) translate(${tx}, ${ty})`;

  const svgPath = svg`<path stroke="#0014aa" fill="${fillColor}" stroke-width="${strokeWidth}" d="${iconPath}" transform="${transform}"/>`;
  const template = html`<svg
    version="1.1"
    shape-rendering="geometricPrecision"
    width="64px"
    height="64px"
    viewBox="-16 -16 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    ${svgPath}
  </svg>`;
  const container = document.createElement("div");
  render(template, container);

  return {
    url: `data:image/svg+xml;base64,${btoa(container.innerHTML)}`,
    id: `${kind}-${isSelected}`,
    width: 64,
    height: 64,
    anchorY: 32,
    mask: false
  };
};

const onLiveClick = (info: PickingInfo<Entity<DatalinkEntity>>, event: unknown) => {
  if (!info.object) return;
  const mods = getModifierKeys(event);
  const exclusive = !mods.ctrlKey && !mods.altKey && !mods.metaKey;
  const entity = info.object;

  if (exclusive) {
    tangramApi.selection.selectEntity(entity, true);
  } else {
    if (datalinkStore.selectedIds.has(entity.id)) {
      tangramApi.selection.deselect({ id: entity.id, type: ENTITY_TYPE });
    } else {
      tangramApi.selection.selectEntity(entity, false);
    }
  }
};

watch(
  [
    () => tangramApi.state.getEntitiesByType<DatalinkEntity>(ENTITY_TYPE).value,
    () => datalinkStore.selectedIds,
    () => tangramApi.map.isReady.value
  ],
  ([entities, selectedIds, isMapReady]) => {
    if (!isMapReady) return;

    const baseData: Entity<DatalinkEntity>[] = [];
    const selectedData: Entity<DatalinkEntity>[] = [];

    for (const entity of entities.values()) {
      if (entity.state.longitude != null && entity.state.latitude != null) {
        if (selectedIds.has(entity.id)) {
          selectedData.push(entity);
        } else {
          baseData.push(entity);
        }
      }
    }

    const data = baseData.concat(selectedData);

    const layer = new IconLayer<Entity<DatalinkEntity>>({
      id: "datalink-entity-layer",
      data,
      pickable: true,
      sizeScale: 1,
      getSize: 32,
      getIcon: d => createIcon(d.state.kind, selectedIds.has(d.id)),
      getPosition: d => [d.state.longitude!, d.state.latitude!],
      getAngle: d => (d.state.kind === "station" ? 0 : -(d.state.track ?? 0) + 180),
      onClick: onLiveClick,
      onHover: (info: PickingInfo<Entity<DatalinkEntity>>) => {
        if (info.object) {
          tooltip.object = info.object;
          tooltip.x = info.x;
          tooltip.y = info.y;
        } else {
          tooltip.object = null;
        }
      },
      updateTriggers: {
        getIcon: Array.from(selectedIds).sort().join(",")
      },
      parameters: { cullMode: "none" }
    });

    layerDisposable.value?.dispose();
    layerDisposable.value = tangramApi.map.setLayer(layer, {
      slot: "entities"
    });
  },
  { deep: true, immediate: true }
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
    <div class="tooltip-grid">
      <template v-if="tooltip.object.state.kind === 'station'">
        <div class="callsign">{{ tooltip.object.state.label }}</div>
        <div class="registration">SQ</div>
        <div class="icao24" :title="airportName(tooltip.object.state.station?.airport)">
          {{ tooltip.object.state.station?.airport }}
        </div>
        <div v-if="tooltip.object.state.station?.frequency_mhz" class="metric right">
          {{ tooltip.object.state.station.frequency_mhz.toFixed(3) }} MHz
        </div>
      </template>
      <template v-else>
        <div class="callsign">{{ tooltip.object.state.label }}</div>
        <div class="registration">{{ tooltip.object.state.aircraft?.registration }}</div>
        <div class="icao24">{{ tooltip.object.state.aircraft?.icao24 }}</div>
        <div v-if="(tooltip.object.state.altitude_ft ?? 0) > 0" class="metric right">
          FL{{ Math.round(((tooltip.object.state.altitude_ft ?? 0) / 1000) * 10) }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.deck-tooltip {
  position: absolute;
  background: var(--t-bg) !important;
  color: var(--t-fg) !important;
  border: 1px solid var(--t-border);
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
.registration {
  text-align: right;
}

.icao24 {
  text-align: left;
}
.metric {
  margin-top: 2px;
}
.metric.right {
  text-align: right;
}
</style>
