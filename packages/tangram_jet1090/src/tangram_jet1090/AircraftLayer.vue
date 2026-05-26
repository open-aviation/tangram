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
      <div v-if="(tooltip.object.state.altitude ?? 0) > 0" class="altitude">
        FL{{ Math.round(((tooltip.object.state.altitude ?? 0) / 1000) * 10) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, reactive, type Ref } from "vue";
import { IconLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram-core/api";
import { findTrajectorySampleIndexAtTime } from "@open-aviation/tangram-core/trajectory";
import { getModifierKeys, resolveBearing } from "@open-aviation/tangram-core/utils";
import { html, svg, render } from "lit-html";
import { get_image_object, type IconProps } from "./PlanePath";
import type { Jet1090Aircraft } from ".";
import { pluginConfig } from "./store";
import {
  importedAircraftTimestamp,
  isJet1090ImportedHistoryDataset
} from "./imported_trajectory";

const FEET_TO_METERS = 0.3048;
const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

interface ImportedAircraftMarker {
  id: string;
  datasetId: string;
  flightIndex: number;
  source: "workspace";
  visible: boolean;
  state: Jet1090Aircraft;
}

interface ImportedFlightCursor {
  flight: ReadonlyArray<Jet1090Aircraft>;
  marker: ImportedAircraftMarker;
  sampleIndex: number | null;
}

type AircraftTooltipItem = Entity<Jet1090Aircraft> | ImportedAircraftMarker;

const aircraftEntities = computed(
  () => tangramApi.state.getEntitiesByType<Jet1090Aircraft>("jet1090_aircraft").value
);
const importedEntries = computed(() =>
  tangramApi.workspace.datasets.value.filter(isJet1090ImportedHistoryDataset)
);
const importedFlightCursors: ImportedFlightCursor[] = [];
const importedAircraftData: ImportedAircraftMarker[] = [];
const selectedIds = ref<ReadonlySet<string>>(new Set());
const selectionDisposable = tangramApi.selection.onChanged(map => {
  selectedIds.value = map.get("jet1090_aircraft") || new Set();
});

const liveLayerDisposable: Ref<Disposable | null> = ref(null);
const importedLayerDisposable: Ref<Disposable | null> = ref(null);

const tooltip = reactive<{
  x: number;
  y: number;
  object: AircraftTooltipItem | null;
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

const getAircraftAngle = (state: Jet1090Aircraft): number => {
  const iconProps = get_image_object(state.typecode || null) as IconProps;
  const direction = resolveBearing(state.track, state.heading) ?? 0;

  return -direction + iconProps.rotcorr;
};

const onLiveClick = (info: PickingInfo<Entity<Jet1090Aircraft>>, event: unknown) => {
  if (!info.object) return;
  const mods = getModifierKeys(event);
  const exclusive = !mods.ctrlKey && !mods.altKey && !mods.metaKey;

  const entity = info.object;

  if (exclusive) {
    tangramApi.selection.selectEntity(entity, true);
  } else {
    if (selectedIds.value.has(entity.id)) {
      tangramApi.selection.deselect({ id: entity.id, type: "jet1090_aircraft" });
    } else {
      tangramApi.selection.selectEntity(entity, false);
    }
  }
};

const onHover = (info: PickingInfo<AircraftTooltipItem>) => {
  if (info.object) {
    tooltip.object = info.object;
    tooltip.x = info.x;
    tooltip.y = info.y;
  } else {
    tooltip.object = null;
  }
};

const syncImportedAircraftTime = (): boolean => {
  let changed = false;

  for (let index = 0; index < importedFlightCursors.length; index += 1) {
    const cursor = importedFlightCursors[index];
    const sampleIndex = findTrajectorySampleIndexAtTime(
      cursor.flight,
      tangramApi.time.currentTime.value,
      importedAircraftTimestamp
    );

    if (sampleIndex === null) {
      if (cursor.sampleIndex !== null || cursor.marker.visible) {
        cursor.sampleIndex = null;
        cursor.marker.visible = false;
        changed = true;
      }

      continue;
    }

    if (cursor.sampleIndex === sampleIndex && cursor.marker.visible) {
      continue;
    }

    cursor.sampleIndex = sampleIndex;
    cursor.marker.state = cursor.flight[sampleIndex];
    cursor.marker.visible = true;
    changed = true;
  }

  return changed;
};

const rebuildImportedAircraftCursors = () => {
  importedFlightCursors.length = 0;
  importedAircraftData.length = 0;

  for (const entry of importedEntries.value) {
    if (!entry.visible) continue;

    entry.payload.flights.forEach((flight, flightIndex) => {
      if (flight.length === 0) return;

      const marker: ImportedAircraftMarker = {
        id: `imported:${entry.id}:${flightIndex}`,
        datasetId: entry.id,
        flightIndex,
        source: "workspace",
        visible: false,
        state: flight[0]
      };

      importedFlightCursors.push({
        flight,
        marker,
        sampleIndex: null
      });
      importedAircraftData.push(marker);
    });
  }

  syncImportedAircraftTime();
};

const renderImportedLayer = (enable3d: boolean) => {
  // TODO: once imported playback markers move to a sprite-backed temporal layer,
  // keep one persistent layer and update buffers instead of calling setLayer() here.
  const layer = new IconLayer<ImportedAircraftMarker>({
    id: "imported-aircraft-layer",
    data: importedAircraftData,
    pickable: true,
    billboard: false,
    sizeScale: 1,
    // NOTE: we tried driving historical icon position/angle/size through
    // `data.attributes` typed arrays to avoid deck.gl accessor work, but that
    // regressed icon rendering in the `setLayer()` flow
    // Keep the sparse imported icon layer for now and revisit later
    getSize: d => (d.visible ? 32 : 0),
    getIcon: d => {
      const typecode = d.state.typecode || "A320";
      return {
        url: createAircraftSvgDataURL(typecode, false),
        id: typecode,
        width: 64,
        height: 64,
        anchorY: 32,
        mask: false
      };
    },
    getPosition: d => [
      d.state.longitude!,
      d.state.latitude!,
      !enable3d ? 0 : (d.state.altitude || 0) * FEET_TO_METERS
    ],
    getAngle: d => (d.visible ? getAircraftAngle(d.state) : 0),
    onHover,
    dataComparator: () => false,
    updateTriggers: {
      getAngle: [tangramApi.time.currentTime.value],
      getPosition: [enable3d, tangramApi.time.currentTime.value],
      getSize: [tangramApi.time.currentTime.value]
    },
    parameters: {
      cullMode: "none"
    }
  });

  importedLayerDisposable.value = tangramApi.map.setLayer(layer, {
    slot: "entities"
  });
};

watch(
  [
    aircraftEntities,
    selectedIds,
    () => tangramApi.map.isReady.value,
    () => pluginConfig.enable3d,
    () => tangramApi.time.isLive.value
  ],
  ([entities, currentSelectedIds, isMapReady, enable3d, isLive]) => {
    if (!isMapReady) return;

    const baseData: Entity<Jet1090Aircraft>[] = [];
    const selectedData: Entity<Jet1090Aircraft>[] = [];

    for (const d of entities.values()) {
      if (currentSelectedIds.has(d.id)) {
        selectedData.push(d);
      } else {
        baseData.push(d);
      }
    }

    const data = isLive ? baseData.concat(selectedData) : [];

    const layer = new IconLayer<Entity<Jet1090Aircraft>>({
      id: "live-aircraft-layer",
      data,
      pickable: true,
      billboard: false,
      sizeScale: 1,
      getSize: 32,
      getIcon: d => {
        const typecode = d.state.typecode || "A320";
        const isSelected = currentSelectedIds.has(d.id);
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
      getPosition: d => [
        d.state.longitude!,
        d.state.latitude!,
        !enable3d ? 0 : (d.state.altitude || 0) * FEET_TO_METERS
      ],
      getAngle: d => getAircraftAngle(d.state),
      onClick: onLiveClick,
      onHover,
      updateTriggers: {
        getIcon: Array.from(currentSelectedIds).sort().join(","),
        getPosition: [enable3d]
      },
      parameters: {
        cullMode: "none"
      }
    });

    liveLayerDisposable.value?.dispose();
    liveLayerDisposable.value = tangramApi.map.setLayer(layer, {
      slot: "entities"
    });
  },
  { immediate: true }
);

watch(
  [importedEntries, () => tangramApi.map.isReady.value],
  ([, isMapReady]) => {
    if (!isMapReady) return;

    rebuildImportedAircraftCursors();
    renderImportedLayer(pluginConfig.enable3d);
  },
  { immediate: true }
);

watch(
  [() => tangramApi.map.isReady.value, () => pluginConfig.enable3d],
  ([isMapReady, enable3d]) => {
    if (!isMapReady) return;
    renderImportedLayer(enable3d);
  }
);

watch(
  [
    () => tangramApi.time.currentTime.value,
    () => tangramApi.map.isReady.value,
    () => tangramApi.time.isLive.value,
    () => pluginConfig.enable3d
  ],
  ([, isMapReady, isLive, enable3d]) => {
    if (!isMapReady || isLive) return;

    if (!syncImportedAircraftTime()) return;
    renderImportedLayer(enable3d);
  }
);

onUnmounted(() => {
  liveLayerDisposable.value?.dispose();
  importedLayerDisposable.value?.dispose();
  selectionDisposable.dispose();
});
</script>

<style>
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

.typecode,
.icao24 {
  text-align: right;
}

.altitude {
  grid-column: 1 / -1;
  margin-top: 2px;
}
</style>
