<script setup lang="ts">
import { inject, watch, onUnmounted, ref, reactive, type Ref } from "vue";
import { IconLayer, LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable, Entity } from "@open-aviation/tangram-core/api";
import type { PickingInfo } from "@deck.gl/core";
import { getModifierKeys } from "@open-aviation/tangram-core/utils";
import { html, svg, render } from "lit-html";
import {
  ENTITY_TYPE,
  isAircraftEntity,
  isStationEntity,
  type DatalinkEntity
} from "./index";
import { airportName } from "./airport";
import { datalinkStore } from "./store";

const entityPassesFilter = (entity: { id: string; state: DatalinkEntity }) => {
  const { filter } = datalinkStore;
  if (!filter.enabled) return true;

  if (isStationEntity(entity.state)) {
    const linkType = entity.state.details.data.link_type;
    const stationCat = linkType === "VDL2" ? "vdl2" : "sq";
    return filter.stations[stationCat] ?? true;
  }

  // aircraft: show if any checked category matches
  const hist = datalinkStore.history.get(entity.id);
  if (!hist || hist.categories.size === 0) return false;
  for (const cat of hist.categories) {
    if (filter.categories[cat]) return true;
  }
  return false;
};

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposable: Ref<Disposable | null> = ref(null);
const routeLayerDisposable: Ref<Disposable | null> = ref(null);
const dotsLayerDisposable: Ref<Disposable | null> = ref(null);

// ── Geometry helpers ──────────────────────────────────────────

const DEG = Math.PI / 180;
const EARTH_NM = 3440.065;

/** Great-circle initial bearing from point A to point B, degrees [0, 360) */
function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG;
  const l1 = lat1 * DEG,
    l2 = lat2 * DEG;
  const y = Math.sin(dLon) * Math.cos(l2);
  const x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Project a point along a great-circle bearing for distanceNm nautical miles */
function projectPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceNm: number
): [number, number] {
  const d = distanceNm / EARTH_NM;
  const brng = bearingDeg * DEG;
  const lat1 = lat * DEG,
    lon1 = lon * DEG;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [lon2 / DEG, lat2 / DEG];
}
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

const stationKindLabel = (linkType: string | null | undefined) => {
  return linkType === "VDL2" ? "VDL2" : `SQ: ${linkType || "?"}`;
};

const formatFrequencies = (frequencies: number[]) => {
  return frequencies.map(freq => `${freq.toFixed(3)} MHz`).join(", ");
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
    () => tangramApi.map.isReady.value,
    () => datalinkStore.version
  ],
  ([entities, selectedIds, isMapReady]) => {
    if (!isMapReady) return;

    const baseData: Entity<DatalinkEntity>[] = [];
    const selectedData: Entity<DatalinkEntity>[] = [];

    for (const entity of entities.values()) {
      if (entity.state.longitude != null && entity.state.latitude != null) {
        if (!entityPassesFilter(entity)) continue;
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
      getIcon: d => createIcon(d.state.details.kind, selectedIds.has(d.id)),
      getPosition: d => [d.state.longitude!, d.state.latitude!],
      getAngle: d => {
        if (isStationEntity(d.state)) return 0;
        // Fallback chain: entity state track → last ADS-C report track
        //   → bearing toward next known waypoint → 0
        const track = d.state.track;
        if (track != null) return -track + 180;
        const hist = datalinkStore.history.get(d.id);
        const adsc = hist?.adsc[0];
        if (adsc?.track != null) return -adsc.track + 180;
        // bearing fallback: current position → next waypoint
        if (adsc?.position && adsc?.next) {
          const b = bearingTo(
            adsc.position.latitude,
            adsc.position.longitude,
            adsc.next.latitude,
            adsc.next.longitude
          );
          return -b + 180;
        }
        if (adsc?.position && adsc?.fixed_projections?.length) {
          const fp = adsc.fixed_projections[0];
          const b = bearingTo(
            adsc.position.latitude,
            adsc.position.longitude,
            fp.latitude,
            fp.longitude
          );
          return -b + 180;
        }
        return 180; // nose up, no rotation
      },
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

    /** Unwrap a longitude so it takes the short arc (<180°) relative to a reference longitude.
     * Works with coordinates outside ±180° — deck.gl handles those correctly. */
    function unwrapLon(lon: number, ref: number): number {
      while (lon - ref > 180) lon -= 360;
      while (ref - lon > 180) lon += 360;
      return lon;
    }

    // ── predicted route overlay: lines + dots ───────────────────────────────
    type Seg = { from: [number, number]; to: [number, number] };
    type Dot = { pos: [number, number]; eta_secs?: number; altitude_ft?: number };
    const routeSegments: Seg[] = [];
    const routeDots: Dot[] = [];

    for (const id of selectedIds) {
      const entity = entities.get(id);
      if (!entity || !isAircraftEntity(entity.state)) continue;
      if (entity.state.longitude == null || entity.state.latitude == null) continue;
      const hist = datalinkStore.history.get(id);
      const adsc = hist?.adsc.find(
        r =>
          r.next != null ||
          r.intermediate_projections?.length ||
          r.fixed_projections?.length
      );
      if (!adsc) continue;

      const curLon = entity.state.longitude;
      const curLat = entity.state.latitude;
      const cur: [number, number] = [curLon, curLat];

      // Collect all waypoints in ETA order
      type Wpt = { lon: number; lat: number; eta_secs?: number; altitude_ft?: number };
      const waypoints: Wpt[] = [];

      // PredictedRoute: next + next_next (no absolute ETA for next_next)
      if (adsc.next) {
        waypoints.push({
          lon: adsc.next.longitude,
          lat: adsc.next.latitude,
          eta_secs: adsc.next.eta_secs,
          altitude_ft: adsc.next.altitude_ft
        });
        if (adsc.next_next) {
          waypoints.push({
            lon: adsc.next_next.longitude,
            lat: adsc.next_next.latitude,
            altitude_ft: adsc.next_next.altitude_ft
          });
        }
      }

      // IntermediateProjection: project from current position
      for (const ip of adsc.intermediate_projections ?? []) {
        if (!ip.track_invalid) {
          const [pLon, pLat] = projectPoint(
            curLat,
            curLon,
            ip.track_degrees,
            ip.distance_nm
          );
          waypoints.push({
            lon: pLon,
            lat: pLat,
            eta_secs: ip.eta_secs,
            altitude_ft: ip.altitude_ft
          });
        }
      }

      // FixedProjection: absolute coordinates
      for (const fp of adsc.fixed_projections ?? []) {
        waypoints.push({
          lon: fp.longitude,
          lat: fp.latitude,
          eta_secs: fp.eta_secs,
          altitude_ft: fp.altitude_ft
        });
      }

      // Sort by ETA when available; keep unknowns at end
      waypoints.sort((a, b) => {
        if (a.eta_secs == null && b.eta_secs == null) return 0;
        if (a.eta_secs == null) return 1;
        if (b.eta_secs == null) return -1;
        return a.eta_secs - b.eta_secs;
      });

      // Build segments: unwrap each longitude relative to the previous point
      // so no segment ever crosses the antimeridian the long way around.
      let prev = cur;
      for (const wpt of waypoints) {
        const lon = unwrapLon(wpt.lon, prev[0]);
        const next: [number, number] = [lon, wpt.lat];
        routeSegments.push({ from: prev, to: next });
        routeDots.push({
          pos: next,
          eta_secs: wpt.eta_secs,
          altitude_ft: wpt.altitude_ft
        });
        prev = next;
      }
    }

    const routeLayer = new LineLayer<Seg>({
      id: "datalink-predicted-route",
      data: routeSegments,
      getSourcePosition: d => d.from,
      getTargetPosition: d => d.to,
      getColor: [100, 180, 255, 180],
      getWidth: 1.5,
      widthUnits: "pixels",
      parameters: { cullMode: "none" }
    });
    routeLayerDisposable.value?.dispose();
    routeLayerDisposable.value = tangramApi.map.setLayer(routeLayer, {
      slot: "routes"
    });

    const dotsLayer = new ScatterplotLayer<Dot>({
      id: "datalink-route-dots",
      data: routeDots,
      getPosition: d => d.pos,
      getFillColor: [100, 180, 255, 220],
      getLineColor: [30, 80, 160, 255],
      stroked: true,
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      getRadius: 4,
      radiusUnits: "pixels",
      parameters: { cullMode: "none" }
    });
    dotsLayerDisposable.value?.dispose();
    dotsLayerDisposable.value = tangramApi.map.setLayer(dotsLayer, { slot: "routes" });
  },
  { deep: true, immediate: true }
);

onUnmounted(() => {
  layerDisposable.value?.dispose();
  routeLayerDisposable.value?.dispose();
  dotsLayerDisposable.value?.dispose();
});
</script>

<template>
  <div
    v-if="tooltip.object"
    class="deck-tooltip"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
  >
    <div class="tooltip-grid">
      <template v-if="tooltip.object.state.details.kind === 'station'">
        <div class="callsign">{{ tooltip.object.state.label }}</div>
        <div class="registration">
          {{ stationKindLabel(tooltip.object.state.details.data.link_type)
          }}<span v-if="tooltip.object.state.details.data.airport">
            ·
            <span :title="airportName(tooltip.object.state.details.data.airport)">{{
              tooltip.object.state.details.data.airport
            }}</span>
          </span>
        </div>
        <div
          class="icao24"
          :title="
            !tooltip.object.state.details.data.hexcode
              ? airportName(tooltip.object.state.details.data.airport)
              : undefined
          "
        >
          {{
            tooltip.object.state.details.data.hexcode ||
            tooltip.object.state.details.data.airport
          }}
        </div>
        <div
          v-if="tooltip.object.state.details.data.frequency_mhz"
          class="metric right"
          :title="
            tooltip.object.state.details.data.supported_frequencies_mhz?.length
              ? `Supported frequencies: ${formatFrequencies(tooltip.object.state.details.data.supported_frequencies_mhz ?? [])}`
              : undefined
          "
        >
          {{ tooltip.object.state.details.data.frequency_mhz?.toFixed(3) }} MHz
        </div>
      </template>
      <template v-else>
        <div class="callsign">{{ tooltip.object.state.label }}</div>
        <div class="registration">
          {{ tooltip.object.state.details.data.registration }}
        </div>
        <div class="icao24">{{ tooltip.object.state.details.data.icao24 }}</div>
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
