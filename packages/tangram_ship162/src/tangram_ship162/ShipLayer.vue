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
import { computed, inject, onUnmounted, ref, watch, reactive, type Ref } from "vue";
import { IconLayer, PolygonLayer } from "@deck.gl/layers";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram-core/api";
import { oklchToDeckGLColor } from "@open-aviation/tangram-core/colour";
import type { Ship162Vessel } from ".";
import type { PickingInfo } from "@deck.gl/core";

// Type alias to match internal use
type ShipState = Ship162Vessel;

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const shipEntities = computed(
  () => tangramApi.state.getEntitiesByType<ShipState>("ship162_ship").value
);
const activeEntities = computed(() => tangramApi.state.activeEntities.value);
const layerDisposable: Ref<Disposable | null> = ref(null);
const hullLayerDisposable: Ref<Disposable | null> = ref(null);
const zoom = computed(() => tangramApi.map.zoom.value);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<ShipState> | null;
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

const isStationary = (state: ShipState): boolean => {
  if (state.speed !== undefined && state.speed < 1.0) return true;
  if (
    state.status === "At anchor" ||
    state.status === "Moored" ||
    state.status === "Aground"
  )
    return true;
  return false;
};

const getIconColor = (
  state: ShipState | undefined
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
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("");

const getShipIcon = (
  state: ShipState,
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
const getShipHullPolygon = (state: ShipState): number[][] | null => {
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

  // Check if we have all required dimension data
  if (!to_bow || !to_stern || !to_port || !to_starboard) {
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

  const coordinate = [longitude, latitude];

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
  const deltaNorth = [(lat2 * radInv - coordinate[1]) / 100, (deltaLon * radInv) / 100];
  // Perpendicular vector for east (rotate by +90deg)
  const rheadingEast = ((finalHeading + 90 + 360) % 360) * rad;
  const sinLat2East = sinLat * cos100R + cosLat * sin100R * Math.cos(rheadingEast);
  const lat2East = Math.asin(sinLat2East);
  const deltaLonEast = Math.atan2(
    Math.sin(rheadingEast) * sin100R * cosLat,
    cos100R - sinLat * sinLat2East
  );
  const deltaEast = [
    (lat2East * radInv - coordinate[1]) / 100,
    (deltaLonEast * radInv) / 100
  ];

  // Move function: [lon + delta[1] * distance, lat + delta[0] * distance]
  const calcMove = (coord: number[], delta: number[], distance: number): number[] => {
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

const onClick = (
  info: PickingInfo<Entity<ShipState>>,
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
  [shipEntities, activeEntities, () => tangramApi.map.isReady.value, zoom],
  ([entities, currentActiveEntities, isMapReady, currentZoom]) => {
    if (!entities || !isMapReady) return;

    if (layerDisposable.value) layerDisposable.value.dispose();
    if (hullLayerDisposable.value) {
      hullLayerDisposable.value.dispose();
      hullLayerDisposable.value = null;
    }

    // added a 0.9 factor because it looked slightly too large
    const sizeScale = 0.9 * Math.min(Math.max(0.5, Math.pow(2, currentZoom - 10)), 2);
    const showHulls = currentZoom >= 12;
    const selectedIds = new Set(currentActiveEntities.keys());

    // Ship hull layer (only visible at high zoom)
    const baseData: Entity<ShipState>[] = [];
    const selectedData: Entity<ShipState>[] = [];
    for (const d of entities.values()) {
      if (selectedIds.has(d.id)) {
        selectedData.push(d);
      } else {
        baseData.push(d);
      }
    }
    const allData = baseData.concat(selectedData);

    if (showHulls) {
      const hullData = allData
        .map(entity => ({
          entity,
          polygon: getShipHullPolygon(entity.state)
        }))
        .filter(({ polygon }) => polygon !== null);

      const hullLayer = new PolygonLayer<{
        entity: Entity<ShipState>;
        polygon: number[][];
      }>({
        id: "ship-hull-layer",
        data: hullData,
        pickable: true,
        stroked: true,
        filled: true,
        wireframe: false,
        lineWidthMinPixels: 1,
        getPolygon: d => d.polygon,
        getFillColor: d => {
          return selectedIds.has(d.entity.id)
            ? colors.selected
            : getIconColor(d.entity.state);
        },
        getLineColor: d => {
          return selectedIds.has(d.entity.id)
            ? colors.selected
            : getIconColor(d.entity.state);
        },
        getLineWidth: 0.5,
        onClick: (info: PickingInfo, event: MjolnirEvent) => {
          if (!info.object) return;
          const entity = (info.object as any).entity;
          const mockInfo = { ...info, object: entity } as PickingInfo<
            Entity<ShipState>
          >;
          onClick(mockInfo, event);
        },
        updateTriggers: {
          getFillColor: [currentActiveEntities]
        }
      });

      const hullDisposable = tangramApi.map.setLayer(hullLayer);
      if (!hullLayerDisposable.value) {
        hullLayerDisposable.value = hullDisposable;
      }
    }

    // Icon layer (always visible, but smaller when hulls are shown)
    const shipLayer = new IconLayer<Entity<ShipState>>({
      id: "ship-layer",
      data: allData,
      pickable: true,
      billboard: false,
      getIcon: d => {
        const { url, id } = getShipIcon(d.state, selectedIds.has(d.id));
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
      getAngle: d => {
        if (isStationary(d.state)) return 0;
        return -(d.state.course || d.state.heading || 0);
      },
      onClick: onClick,
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
        getIcon: Array.from(currentActiveEntities.keys()).sort().join(","),
        sizeScale: [showHulls]
      },
      // required for globe: https://github.com/visgl/deck.gl/issues/9777#issuecomment-3628393899
      parameters: {
        cullMode: "none"
      }
    });

    layerDisposable.value = tangramApi.map.setLayer(shipLayer);
  },
  { immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
  hullLayerDisposable.value?.dispose();
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
