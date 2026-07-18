<template>
  <div
    v-if="tooltip.object"
    class="minisky-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <div class="tooltip-grid">
      <div class="callsign">{{ tooltip.object.state.callsign }}</div>
      <div class="typecode">{{ tooltip.object.state.typecode }}</div>
      <div v-if="tooltip.object.state.altitude != null" class="detail">
        FL{{ Math.round((tooltip.object.state.altitude ?? 0) / 100) }}
      </div>
      <div v-if="tooltip.object.state.groundspeed != null" class="detail right">
        {{ Math.round(tooltip.object.state.groundspeed ?? 0) }} kt
      </div>
      <div v-if="tooltip.object.state.inconf" class="conflict">CONFLICT</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, reactive, ref, watch, type Ref } from "vue";
import { IconLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram-core/api";
import { getModifierKeys } from "@open-aviation/tangram-core/utils";
import type { MiniskyAircraft } from "./store";
import { ENTITY_TYPE } from ".";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

// A320-style silhouette (from the jet1090 plugin icon set), 24x28 units
const AC_PATH =
  "M12,28 13,26 14,23 14,18 16,17 16,19 18,19 18,16 24,11 24,10 23,10 15,13 " +
  "14,13 13,6 13,5 16,2 16,0 13,2 12,0 11,2 8,0 8,2 11,5 11,6 10,13 9,13 " +
  "1,10 0,10 0,11 6,16 6,19 8,19 8,17 10,18 10,23 11,26 12,28z";
const ROT_CORR = 180;

const aircraftEntities = computed(
  () => tangramApi.state.getEntitiesByType<MiniskyAircraft>(ENTITY_TYPE).value
);

const selectedIds = ref<ReadonlySet<string>>(new Set());
const selectionDisposable = tangramApi.selection.onChanged(map => {
  selectedIds.value = map.get(ENTITY_TYPE) || new Set();
});

const layerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<MiniskyAircraft> | null;
}>({ x: 0, y: 0, object: null });

const iconCache = new Map<string, string>();

const createAircraftSvgDataURL = (variant: string): string => {
  if (iconCache.has(variant)) return iconCache.get(variant)!;

  const fillColor =
    variant === "selected" ? "#ff6464" : variant === "conflict" ? "#ff9d1c" : "#f9fd15";
  const scale = 0.7;
  // center the 24x28 path on the origin of the 32x32 viewbox
  const transform = `scale(${scale}) translate(-12, -14)`;
  const strokeWidth = 0.65 / scale;

  const svgString =
    `<svg version="1.1" shape-rendering="geometricPrecision" width="64px" height="64px" ` +
    `viewBox="-16 -16 32 32" xmlns="http://www.w3.org/2000/svg">` +
    `<path stroke="#0014aa" fill="${fillColor}" stroke-width="${strokeWidth}" ` +
    `d="${AC_PATH}" transform="${transform}"/></svg>`;

  const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`;
  iconCache.set(variant, dataUrl);
  return dataUrl;
};

const iconVariant = (d: Entity<MiniskyAircraft>): string => {
  if (selectedIds.value.has(d.id)) return "selected";
  if (d.state.inconf) return "conflict";
  return "base";
};

const onClick = (info: PickingInfo<Entity<MiniskyAircraft>>, event: unknown) => {
  if (!info.object) return;
  const mods = getModifierKeys(event);
  const exclusive = !mods.ctrlKey && !mods.altKey && !mods.metaKey;

  const entity = info.object;
  if (exclusive) {
    tangramApi.selection.selectEntity(entity, true);
  } else if (selectedIds.value.has(entity.id)) {
    tangramApi.selection.deselect({ id: entity.id, type: ENTITY_TYPE });
  } else {
    tangramApi.selection.selectEntity(entity, false);
  }
};

const onHover = (info: PickingInfo<Entity<MiniskyAircraft>>) => {
  if (info.object) {
    tooltip.object = info.object;
    tooltip.x = info.x;
    tooltip.y = info.y;
  } else {
    tooltip.object = null;
  }
};

watch(
  [aircraftEntities, selectedIds, () => tangramApi.map.isReady.value],
  ([entities, currentSelectedIds, isMapReady]) => {
    if (!isMapReady) return;

    const data = Array.from(entities.values());

    const layer = new IconLayer<Entity<MiniskyAircraft>>({
      id: "minisky-aircraft-layer",
      data,
      pickable: true,
      billboard: false,
      sizeScale: 1,
      getSize: 32,
      getIcon: d => {
        const variant = iconVariant(d);
        return {
          url: createAircraftSvgDataURL(variant),
          id: variant,
          width: 64,
          height: 64,
          anchorY: 32,
          mask: false
        };
      },
      getPosition: d => [d.state.longitude!, d.state.latitude!, 0],
      getAngle: d => -(d.state.track ?? 0) + ROT_CORR,
      onClick,
      onHover,
      updateTriggers: {
        getIcon: Array.from(currentSelectedIds).sort().join(",")
      },
      parameters: {
        cullMode: "none"
      }
    });

    layerDisposable.value?.dispose();
    layerDisposable.value = tangramApi.map.setLayer(layer, { slot: "entities" });
  },
  { immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
  selectionDisposable.dispose();
});
</script>

<style>
.minisky-tooltip {
  position: absolute;
  background: var(--t-bg);
  color: var(--t-fg);
  border: 1px solid var(--t-border);
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(10px, -20px);
  z-index: 10;
  min-width: 110px;
}

.minisky-tooltip .tooltip-grid {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.5rem;
}

.minisky-tooltip .callsign {
  font-weight: bold;
  font-size: 1.1em;
}

.minisky-tooltip .typecode {
  text-align: right;
}

.minisky-tooltip .right {
  text-align: right;
}

.minisky-tooltip .conflict {
  grid-column: 1 / -1;
  color: #ff9d1c;
  font-weight: bold;
}
</style>
