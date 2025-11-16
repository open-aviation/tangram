<template>
  <div
    v-if="tooltip.object"
    class="deck-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <div class="tooltip-grid">
      <div class="ship-name">{{ tooltip.object.state.ship_name || "N/A" }}</div>
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
import { IconLayer } from "@deck.gl/layers";
import type { TangramApi, Entity, Disposable } from "@open-aviation/tangram/api";

export interface MmsiInfo {
  mmsi_type: string;
  country?: {
    country: string;
    flag: string;
    "iso-3166-1": string;
  };
}

export interface ShipState {
  latitude: number;
  longitude: number;
  ship_name: string;
  course: number;
  mmsi: string;
  speed?: number;
  destination?: string;
  mmsi_info?: MmsiInfo;
  ship_type?: string;
  status?: string;
  callsign?: string;
  heading?: number;
  imo?: number;
  draught?: number;
  to_bow?: number;
  to_stern?: number;
  to_port?: number;
  to_starboard?: number;
  turn?: number;
}

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const shipEntities = computed(
  () => tangramApi.state.getEntitiesByType<ShipState>("ship162_ship").value
);
const activeEntityId = computed(() => tangramApi.state.activeEntityId?.value);
const layerDisposable: Ref<Disposable | null> = ref(null);
const zoom = computed(() => tangramApi.map.zoom.value);

const tooltip = reactive<{
  x: number;
  y: number;
  object: Entity<ShipState> | null;
}>({ x: 0, y: 0, object: null });

const colors = {
  passenger: "oklch(65% 0.2 260)", // blue
  cargo: "oklch(65% 0.15 140)", // green
  tanker: "oklch(65% 0.2 40)", // red-orange
  high_speed: "oklch(90% 0.25 90)", // yellow
  pleasure: "oklch(65% 0.2 330)", // magenta
  fishing: "oklch(70% 0.2 200)", // cyan
  special: "oklch(75% 0.18 70)", // orange
  aton: "oklch(90% 0.25 90)", // yellow
  sar: "oklch(70% 0.25 50)", // orange
  default: "oklch(60% 0 0)", // grey
  selected: "oklch(70% 0.25 20)" // bright red
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

const getIconColor = (state: ShipState | undefined): string => {
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
    switch (state.mmsi_info.mmsi_type) {
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

const getShipIcon = (state: ShipState, isSelected: boolean): string => {
  const stationary = isStationary(state);
  const isAton = state.mmsi_info?.mmsi_type === "AIS AtoN";
  const color = isSelected ? colors.selected : getIconColor(state);
  const cacheKey = `${color}-${stationary}-${isAton}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
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
  return dataUrl;
};

watch(
  [shipEntities, activeEntityId, () => tangramApi.map.isReady.value, zoom],
  ([entities, activeId, isMapReady, currentZoom]) => {
    if (!entities || !isMapReady) return;

    if (layerDisposable.value) {
      layerDisposable.value.dispose();
    }

    const sizeScale = Math.min(Math.max(0.5, Math.pow(2, currentZoom - 10)), 2);

    const shipLayer = new IconLayer<Entity<ShipState>>({
      id: "ship-layer",
      data: Array.from(entities.values()),
      pickable: true,
      billboard: false,
      getIcon: d => ({
        url: getShipIcon(d.state, d.id === activeId),
        width: 24,
        height: 24,
        anchorY: 12
      }),
      sizeScale: sizeScale,
      getPosition: d => [d.state.longitude, d.state.latitude],
      getSize: 24,
      getAngle: d => {
        if (isStationary(d.state)) return 0;
        return -(d.state.course || d.state.heading || 0);
      },
      onClick: ({ object }) => {
        if (object) {
          tangramApi.state.setActiveEntity(object.id);
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
        getIcon: [activeId]
      }
    });

    layerDisposable.value = tangramApi.map.addLayer(shipLayer);
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
