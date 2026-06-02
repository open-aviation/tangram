<template>
  <div
    v-if="tooltip.object"
    class="deck-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <div class="tooltip-grid">
      <div class="ship-name">
        {{ tooltip.object.state.mmsi_info?.flag }}
        {{ tooltip.object.state.ship_name || "N/A" }}
      </div>
      <div></div>

      <div class="ship-type">{{ tooltip.object.state.ship_type }}</div>
      <div class="mmsi">{{ tooltip.object.state.mmsi }}</div>
      <div v-if="tooltip.object.state.speed" class="speed">
        {{ tooltip.object.state.speed.toFixed(1) }} kts
      </div>
      <div v-if="tooltip.object.state.course" class="course">
        {{ tooltip.object.state.course.toFixed(0) }}°
      </div>
      <div v-if="tooltip.object.state.destination" class="destination">
        {{ tooltip.object.state.destination }}
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, inject, onUnmounted, reactive, ref, watch, type Ref } from "vue";
import { IconLayer, PolygonLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram-core/api";
import { findTrajectorySampleIndexAtTime } from "@open-aviation/tangram-core/trajectory";
import {
  getModifierKeys,
  oklchToDeckGLColor,
  resolveBearing
} from "@open-aviation/tangram-core/utils";
import type { Ship162Vessel } from ".";
import {
  importedShipTimestamp,
  isShip162ImportedHistoryDataset
} from "./imported_trajectory";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

interface ImportedShipMarker {
  id: string;
  datasetId: string;
  trackIndex: number;
  source: "workspace";
  visible: boolean;
  state: Ship162Vessel;
}

interface ImportedShipHull {
  marker: ImportedShipMarker;
  polygon: number[][];
}

interface ImportedTrackCursor {
  track: ReadonlyArray<Ship162Vessel>;
  marker: ImportedShipMarker;
  hull: ImportedShipHull;
  sampleIndex: number | null;
}

type ShipTooltipItem = Entity<Ship162Vessel> | ImportedShipMarker;

const shipEntities = computed(
  () => tangramApi.state.getEntitiesByType<Ship162Vessel>("ship162_ship").value
);
const importedEntries = computed(() =>
  tangramApi.workspace.datasets.value.filter(isShip162ImportedHistoryDataset)
);
const importedTrackCursors: ImportedTrackCursor[] = [];
const importedShipsData: ImportedShipMarker[] = [];
const importedShipHullData: ImportedShipHull[] = [];

const getShipAngle = (state: Ship162Vessel): number => {
  if (isStationary(state)) return 0;
  return -(resolveBearing(state.course, state.heading) ?? 0);
};

const getHiddenShipPolygon = (state: Ship162Vessel): number[][] => {
  const point: [number, number] = [state.longitude ?? 0, state.latitude ?? 0];
  return [point, point, point, point];
};

const syncImportedShipsTime = (): boolean => {
  let changed = false;

  for (let index = 0; index < importedTrackCursors.length; index += 1) {
    const cursor = importedTrackCursors[index];
    const sampleIndex = findTrajectorySampleIndexAtTime(
      cursor.track,
      tangramApi.time.currentTime.value,
      importedShipTimestamp
    );

    if (sampleIndex === null) {
      if (cursor.sampleIndex !== null || cursor.marker.visible) {
        cursor.sampleIndex = null;
        cursor.marker.visible = false;
        cursor.hull.polygon = getHiddenShipPolygon(cursor.marker.state);
        changed = true;
      }

      continue;
    }

    if (cursor.sampleIndex === sampleIndex && cursor.marker.visible) {
      continue;
    }

    cursor.sampleIndex = sampleIndex;
    cursor.marker.state = cursor.track[sampleIndex];
    cursor.marker.visible = true;
    cursor.hull.polygon =
      getShipHullPolygon(cursor.marker.state) ??
      getHiddenShipPolygon(cursor.marker.state);
    changed = true;
  }

  return changed;
};

const rebuildImportedTrackCursors = () => {
  importedTrackCursors.length = 0;
  importedShipsData.length = 0;
  importedShipHullData.length = 0;

  for (const entry of importedEntries.value) {
    if (!entry.visible) continue;

    entry.payload.tracks.forEach((track, trackIndex) => {
      if (track.length === 0) return;

      const marker: ImportedShipMarker = {
        id: `imported:${entry.id}:${trackIndex}`,
        datasetId: entry.id,
        trackIndex,
        source: "workspace",
        visible: false,
        state: track[0]
      };
      const hull: ImportedShipHull = {
        marker,
        polygon: getHiddenShipPolygon(track[0])
      };

      importedTrackCursors.push({
        track,
        marker,
        hull,
        sampleIndex: null
      });
      importedShipsData.push(marker);
      importedShipHullData.push(hull);
    });
  }

  syncImportedShipsTime();
};

const selectedIds = ref<ReadonlySet<string>>(new Set());
const selectionDisposable = tangramApi.selection.onChanged(map => {
  selectedIds.value = map.get("ship162_ship") || new Set();
});

const liveLayerDisposable: Ref<Disposable | null> = ref(null);
const importedLayerDisposable: Ref<Disposable | null> = ref(null);
const liveHullLayerDisposable: Ref<Disposable | null> = ref(null);
const importedHullLayerDisposable: Ref<Disposable | null> = ref(null);
const zoom = computed(() => tangramApi.map.zoom.value);

const tooltip = reactive<{
  x: number;
  y: number;
  object: ShipTooltipItem | null;
}>({ x: 0, y: 0, object: null });

const colors = {
  passenger: oklchToDeckGLColor(0.65, 0.2, 260, 180), // blue
  cargo: oklchToDeckGLColor(0.65, 0.15, 140, 180), // green
  tanker: oklchToDeckGLColor(0.65, 0.2, 40, 180), // red-orange
  high_speed: oklchToDeckGLColor(0.9, 0.25, 90, 180), // yellow
  pleasure: oklchToDeckGLColor(0.65, 0.2, 330, 180), // magenta
  fishing: oklchToDeckGLColor(0.7, 0.2, 200, 180), // cyan
  special: oklchToDeckGLColor(0.75, 0.18, 70, 180), // orange
  aton: oklchToDeckGLColor(0.9, 0.25, 90, 180), // yellow
  sar: oklchToDeckGLColor(0.7, 0.25, 50, 180), // orange
  default: oklchToDeckGLColor(0.6, 0, 0, 180), // grey
  selected: oklchToDeckGLColor(0.7, 0.25, 20, 220) // bright red
};

const isStationary = (state: Ship162Vessel): boolean => {
  if (state.speed !== undefined && state.speed < 1.0) return true;
  if (
    state.status === "At anchor" ||
    state.status === "Moored" ||
    state.status === "Aground"
  ) {
    return true;
  }
  return false;
};

const getIconColor = (
  state: Ship162Vessel | undefined
): [number, number, number, number] => {
  if (!state) return colors.default;

  switch (state.ship_type) {
    case "Passenger":
      return colors.passenger;
    case "Cargo":
      return colors.cargo;
    case "Tanker":
      return colors.tanker;
    case "High Speed Craft":
      return colors.high_speed;
    case "Pleasure craft":
    case "Sailing":
      return colors.pleasure;
    case "Fishing":
      return colors.fishing;
    case "Tug":
    case "Towing":
    case "Towing, large":
    case "Pilot Vessel":
    case "Search and Rescue":
    case "Port Tender":
    case "Dredging or underwater operations":
    case "Diving operations":
    case "Military operations":
    case "Law Enforcement":
    case "Anti-Pollution Equipment":
      return colors.special;
  }

  if (state.mmsi_info) {
    switch (state.ship_type) {
      case "SAR Aircraft":
        return colors.sar;
      case "AIS AtoN":
        return colors.aton;
    }
  }

  return colors.default;
};

const pointySvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-12 -12 24 24" fill="${color}" stroke="black" stroke-width="0.5"><path d="M 0 -10 L 4 8 L 0 5 L -4 8 Z"/></svg>`;
const circleSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-12 -12 24 24" fill="${color}" stroke="black" stroke-width="0.5"><circle cx="0" cy="0" r="4"/></svg>`;
const diamondSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-12 -12 24 24" fill="${color}" stroke="black" stroke-width="0.5"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></svg>`;

const iconCache = new Map<string, string>();

const rgbToHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join("");

const getShipIcon = (
  state: Ship162Vessel,
  isSelected: boolean
): { url: string; id: string } => {
  const stationary = isStationary(state);
  const isAton = state.ship_type === "AIS AtoN";
  const colorArray = isSelected ? colors.selected : getIconColor(state);
  const color = rgbToHex(colorArray[0], colorArray[1], colorArray[2]);
  const cacheKey = `${color}-${stationary}-${isAton}`;

  if (iconCache.has(cacheKey)) {
    return { url: iconCache.get(cacheKey)!, id: cacheKey };
  }

  let svg;
  if (isAton) {
    svg = diamondSvg(color);
  } else if (stationary) {
    svg = circleSvg(color);
  } else {
    svg = pointySvg(color);
  }

  const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
  iconCache.set(cacheKey, dataUrl);
  return { url: dataUrl, id: cacheKey };
};

/**
 * Calculate ship hull polygon coordinates based on AIS dimensions.
 * Returns a polygon in [lon, lat] format relative to ship's position.
 * This implementation matches the algorithm in AISCatcher's script.js.
 */
const getShipHullPolygon = (state: Ship162Vessel): number[][] | null => {
  const {
    to_bow,
    to_stern,
    to_port,
    to_starboard,
    latitude,
    longitude,
    course,
    heading
  } = state;

  if (
    to_bow == null ||
    to_stern == null ||
    to_port == null ||
    to_starboard == null ||
    latitude == null ||
    longitude == null
  ) {
    return null;
  }

  // Use heading if available, otherwise course
  let finalHeading = heading;

  if (finalHeading === null || finalHeading === undefined) {
    if (course != null && state.speed && state.speed > 1) {
      finalHeading = course;
    } else {
      // No valid heading - can't draw oriented shape
      return null;
    }
  }

  const coordinate: [number, number] = [longitude, latitude];

  // Calculate offset for 1 meter in lat/lon at this position
  // This matches aiscatcher.js's calcOffset1M
  // const R = 6378137; // Earth radius in meters (WGS84)
  const cos100R = 0.9999999998770914; // cos(100m / R)
  const sin100R = 1.567855942823164e-5; // sin(100m / R)
  const rad = Math.PI / 180;
  const radInv = 180 / Math.PI;

  const lat = coordinate[1] * rad;
  const rheading = ((finalHeading + 360) % 360) * rad;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  const sinLat2 = sinLat * cos100R + cosLat * sin100R * Math.cos(rheading);
  const lat2 = Math.asin(sinLat2);
  const deltaLon = Math.atan2(
    Math.sin(rheading) * sin100R * cosLat,
    cos100R - sinLat * sinLat2
  );

  // deltaNorth: [deltaLat, deltaLon] for 1m north
  // deltaEast: [deltaLat, deltaLon] for 1m east (perpendicular to north)
  const deltaNorth: [number, number] = [
    (lat2 * radInv - coordinate[1]) / 100,
    (deltaLon * radInv) / 100
  ];
  // Perpendicular vector for east (rotate by +90deg)
  const rheadingEast = ((finalHeading + 90 + 360) % 360) * rad;
  const sinLat2East = sinLat * cos100R + cosLat * sin100R * Math.cos(rheadingEast);
  const lat2East = Math.asin(sinLat2East);
  const deltaLonEast = Math.atan2(
    Math.sin(rheadingEast) * sin100R * cosLat,
    cos100R - sinLat * sinLat2East
  );
  const deltaEast: [number, number] = [
    (lat2East * radInv - coordinate[1]) / 100,
    (deltaLonEast * radInv) / 100
  ];

  // Move function: [lon + delta[1] * distance, lat + delta[0] * distance]
  const calcMove = (
    coord: [number, number],
    delta: [number, number],
    distance: number
  ): [number, number] => {
    return [coord[0] + delta[1] * distance, coord[1] + delta[0] * distance];
  };

  // Ship outline points (AISCatcher logic)
  // const bow = calcMove(coordinate, deltaNorth, to_bow);
  const stern = calcMove(coordinate, deltaNorth, -to_stern);

  const A = calcMove(stern, deltaEast, to_starboard);
  const B = calcMove(stern, deltaEast, -to_port);
  const C = calcMove(B, deltaNorth, 0.8 * (to_bow + to_stern));
  const Dmid = calcMove(C, deltaEast, 0.5 * (to_starboard + to_port));
  const D = calcMove(Dmid, deltaNorth, 0.2 * (to_bow + to_stern));
  const E = calcMove(C, deltaEast, to_starboard + to_port);

  // Return ship outline as closed polygon
  return [A, B, C, D, E, A];
};

const onLiveClick = (info: PickingInfo<Entity<Ship162Vessel>>, event: unknown) => {
  if (!info.object) return;
  const mods = getModifierKeys(event);
  const exclusive = !mods.ctrlKey && !mods.altKey && !mods.metaKey;

  const entity = info.object;

  if (exclusive) {
    tangramApi.selection.selectEntity(entity, true);
  } else if (selectedIds.value.has(entity.id)) {
    tangramApi.selection.deselect({ id: entity.id, type: "ship162_ship" });
  } else {
    tangramApi.selection.selectEntity(entity, false);
  }
};

const onHover = (info: PickingInfo<ShipTooltipItem>) => {
  if (info.object) {
    tooltip.object = info.object;
    tooltip.x = info.x;
    tooltip.y = info.y;
  } else {
    tooltip.object = null;
  }
};

const renderImportedShipLayer = (currentZoom: number) => {
  const sizeScale = 0.9 * Math.min(Math.max(0.5, Math.pow(2, currentZoom - 10)), 2);
  const showHulls = currentZoom >= 12;

  if (showHulls) {
    const hullLayer = new PolygonLayer<ImportedShipHull>({
      id: "imported-ship-hull-layer",
      data: importedShipHullData,
      pickable: false,
      stroked: true,
      filled: true,
      wireframe: false,
      lineWidthMinPixels: 1,
      getPolygon: d => d.polygon,
      getFillColor: d =>
        d.marker.visible ? getIconColor(d.marker.state) : ([0, 0, 0, 0] as const),
      getLineColor: d =>
        d.marker.visible ? getIconColor(d.marker.state) : ([0, 0, 0, 0] as const),
      getLineWidth: 0.5
    });

    importedHullLayerDisposable.value = tangramApi.map.setLayer(hullLayer, {
      slot: "entities_underlay"
    });
  } else if (importedHullLayerDisposable.value) {
    importedHullLayerDisposable.value.dispose();
    importedHullLayerDisposable.value = null;
  }

  const shipLayer = new IconLayer<ImportedShipMarker>({
    id: "imported-ship-layer",
    data: importedShipsData,
    pickable: true,
    billboard: false,
    // TODO: once imported playback markers move to a sprite-backed temporal layer,
    // keep one persistent layer and update buffers instead of calling setLayer() here.
    // NOTE: the sparse imported icon layer still uses Tangram's setLayer path.
    // We also tried feeding historical icon position/angle/size
    // through `data.attributes` typed arrays, but that regressed icon
    // rendering. The heavy playback geometry is handled separately by the
    // mutable timed trajectory controller.
    getIcon: d => {
      const { url, id } = getShipIcon(d.state, false);
      return {
        url,
        id,
        width: 24,
        height: 24,
        anchorY: 12,
        mask: false
      };
    },
    sizeScale: showHulls ? sizeScale * 0.5 : sizeScale,
    getPosition: d => [d.state.longitude!, d.state.latitude!],
    getSize: d => (d.visible ? 24 : 0),
    getAngle: d => (d.visible ? getShipAngle(d.state) : 0),
    onHover,
    dataComparator: () => false,
    updateTriggers: {
      getAngle: [tangramApi.time.currentTime.value],
      getSize: [tangramApi.time.currentTime.value],
      sizeScale: [showHulls, tangramApi.time.currentTime.value]
    },
    parameters: {
      cullMode: "none"
    }
  });

  importedLayerDisposable.value = tangramApi.map.setLayer(shipLayer, {
    slot: "entities"
  });
};

watch(
  [
    shipEntities,
    selectedIds,
    () => tangramApi.map.isReady.value,
    zoom,
    () => tangramApi.time.isLive.value
  ],
  ([entities, currentSelectedIds, isMapReady, currentZoom, isLive]) => {
    if (!isMapReady) return;

    const sizeScale = 0.9 * Math.min(Math.max(0.5, Math.pow(2, currentZoom - 10)), 2);
    const showHulls = currentZoom >= 12;
    const baseData: Entity<Ship162Vessel>[] = [];
    const selectedData: Entity<Ship162Vessel>[] = [];

    for (const entity of entities.values()) {
      if (currentSelectedIds.has(entity.id)) {
        selectedData.push(entity);
      } else {
        baseData.push(entity);
      }
    }

    const data = isLive ? baseData.concat(selectedData) : [];

    if (showHulls && isLive) {
      const hullData = data
        .map(entity => ({
          entity,
          polygon: getShipHullPolygon(entity.state)
        }))
        .filter(({ polygon }) => polygon !== null);

      const hullLayer = new PolygonLayer<{
        entity: Entity<Ship162Vessel>;
        polygon: number[][];
      }>({
        id: "live-ship-hull-layer",
        data: hullData,
        pickable: true,
        stroked: true,
        filled: true,
        wireframe: false,
        lineWidthMinPixels: 1,
        getPolygon: d => d.polygon,
        getFillColor: d =>
          currentSelectedIds.has(d.entity.id)
            ? colors.selected
            : getIconColor(d.entity.state),
        getLineColor: d =>
          currentSelectedIds.has(d.entity.id)
            ? colors.selected
            : getIconColor(d.entity.state),
        getLineWidth: 0.5,
        onClick: (info: PickingInfo, event: unknown) => {
          if (!info.object) return;
          const hullInfo = info.object as {
            entity: Entity<Ship162Vessel>;
            polygon: number[][];
          };
          onLiveClick(
            { ...info, object: hullInfo.entity } as PickingInfo<Entity<Ship162Vessel>>,
            event
          );
        },
        updateTriggers: {
          getFillColor: [currentSelectedIds],
          getLineColor: [currentSelectedIds]
        }
      });

      liveHullLayerDisposable.value?.dispose();
      liveHullLayerDisposable.value = tangramApi.map.setLayer(hullLayer, {
        slot: "entities_underlay"
      });
    } else if (liveHullLayerDisposable.value) {
      liveHullLayerDisposable.value.dispose();
      liveHullLayerDisposable.value = null;
    }

    const shipLayer = new IconLayer<Entity<Ship162Vessel>>({
      id: "live-ship-layer",
      data,
      pickable: true,
      billboard: false,
      getIcon: d => {
        const { url, id } = getShipIcon(d.state, currentSelectedIds.has(d.id));
        return {
          url,
          id,
          width: 24,
          height: 24,
          anchorY: 12,
          mask: false
        };
      },
      sizeScale: showHulls ? sizeScale * 0.5 : sizeScale,
      getPosition: d => [d.state.longitude!, d.state.latitude!],
      getSize: 24,
      getAngle: d => getShipAngle(d.state),
      onClick: onLiveClick,
      onHover,
      updateTriggers: {
        getIcon: Array.from(currentSelectedIds).sort().join(","),
        sizeScale: [showHulls]
      },
      parameters: {
        cullMode: "none"
      }
    });

    liveLayerDisposable.value?.dispose();
    liveLayerDisposable.value = tangramApi.map.setLayer(shipLayer, {
      slot: "entities"
    });
  },
  { immediate: true }
);

watch(
  [importedEntries, () => tangramApi.map.isReady.value],
  ([, isMapReady]) => {
    if (!isMapReady) return;
    rebuildImportedTrackCursors();
    renderImportedShipLayer(zoom.value);
  },
  { immediate: true }
);

watch([() => tangramApi.map.isReady.value, zoom], ([isMapReady, currentZoom]) => {
  if (!isMapReady) return;
  renderImportedShipLayer(currentZoom);
});

watch(
  [
    () => tangramApi.time.currentTime.value,
    () => tangramApi.map.isReady.value,
    () => tangramApi.time.isLive.value
  ],
  ([, isMapReady, isLive]) => {
    if (!isMapReady || isLive) return;
    if (!syncImportedShipsTime()) return;
    renderImportedShipLayer(zoom.value);
  }
);

onUnmounted(() => {
  liveLayerDisposable.value?.dispose();
  importedLayerDisposable.value?.dispose();
  liveHullLayerDisposable.value?.dispose();
  importedHullLayerDisposable.value?.dispose();
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
  border-radius: 4px;
  font-size: 11px;
  font-family: "B612", sans-serif;
  pointer-events: none;
  transform: translate(10px, -20px);
  z-index: 10;
  min-width: 120px;
}
.tooltip-grid {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.5rem;
}
.ship-name {
  font-weight: bold;
  grid-column: 1 / 2;
}
.mmsi {
  text-align: right;
  grid-column: 2 / 3;
}
.speed {
  grid-column: 1 / 2;
}
.course {
  text-align: right;
  grid-column: 2 / 3;
}
.destination {
  grid-column: 1 / -1;
  margin-top: 2px;
}
</style>
