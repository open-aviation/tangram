<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watchEffect, type Ref } from "vue";
import * as L from "leaflet";
import "leaflet-rotatedmarker";
import Raphael from "raphael";
import { html, svg, render } from "lit-html";
import type { TangramApi, EntityId } from "@open-aviation/tangram/api";
import { get_image_object } from "./PlanePath";

interface AircraftState {
  latitude: number;
  longitude: number;
  typecode: string;
  callsign: string;
  track: number;
  icao24: string;
  registration: string;
  altitude: number;
}

const tangramApi = inject<Ref<TangramApi | null>>("tangramApi");
const aircraftEntities = computed(
  () => tangramApi?.value?.state.getEntitiesByType<AircraftState>("aircraft").value
);
const activeEntityId = computed(() => tangramApi?.value?.state.activeEntityId?.value);

const aircraftMarkers = ref(new Map<EntityId, L.Marker>());

const createAircraftSvg = (icao24: string, iconProps: any): HTMLElement => {
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

  const path = svg`<path stroke="#0014aa" stroke-width="0.65" d="${transformedPath}"/>`;
  const template = html`<svg
    id="${icao24}"
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
  return container;
};

const getIcon = (feature: AircraftState) => {
  const iconProps = get_image_object(feature.typecode);
  const iconHtml = createAircraftSvg(feature.icao24, iconProps);
  const className =
    activeEntityId.value === feature.icao24 ? "aircraft_selected" : "aircraft_default";
  return L.divIcon({
    html: iconHtml,
    className: className,
    iconSize: [33, 35],
    iconAnchor: [16.5, 17.5]
  });
};

const getRotate = (feature: AircraftState) => {
  const iconProps = get_image_object(feature.typecode);
  return (feature.track + iconProps.rotcorr) % 360;
};

const createTooltipTemplate = (aircraft: AircraftState) => {
  const altitude =
    aircraft.altitude > 0
      ? html`<div class="altitude">FL${Math.round(aircraft.altitude / 1000) * 10}</div>`
      : "";
  return html`
    <div class="tooltip-grid">
      <div class="callsign">${aircraft.callsign}</div>
      <div class="typecode">${aircraft.typecode}</div>
      <div class="registration">${aircraft.registration}</div>
      <div class="icao24">${aircraft.icao24}</div>
      ${altitude}
    </div>
  `;
};

// TODO: fix icon colour not changing when aircraft is selected
// but v0.1 didn't work either so... eh
watchEffect(() => {
  if (!tangramApi?.value || !aircraftEntities?.value || !tangramApi.value.map.isReady)
    return;

  const api = tangramApi.value;
  const map = api.map.getMapInstance();
  const currentMarkers = aircraftMarkers.value;
  const newMarkerIds = new Set<EntityId>();

  for (const entity of aircraftEntities.value.values()) {
    newMarkerIds.add(entity.id);
    const aircraft = entity.state as AircraftState;
    if (aircraft.latitude == null || aircraft.longitude == null) continue;

    const latLng = new L.LatLng(aircraft.latitude, aircraft.longitude);

    if (currentMarkers.has(entity.id)) {
      const marker = currentMarkers.get(entity.id)!;
      marker.setLatLng(latLng);
      (marker as any).setRotationAngle(getRotate(aircraft));
      marker.setIcon(getIcon(aircraft));

      const tooltip = marker.getTooltip();
      if (tooltip) {
        const container = tooltip.getContent() as HTMLElement;
        if (container) {
          render(createTooltipTemplate(aircraft), container);
        }
      }
    } else {
      const marker = L.marker(latLng, {
        icon: getIcon(aircraft),
        rotationAngle: getRotate(aircraft)
      } as L.MarkerOptions).addTo(map);

      const tooltipContainer = document.createElement("div");
      render(createTooltipTemplate(aircraft), tooltipContainer);

      marker.bindTooltip(tooltipContainer, {
        direction: "top",
        offset: [0, -10],
        className: "leaflet-tooltip-custom"
      });

      marker.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        api.state.setActiveEntity(entity.id);
      });
      currentMarkers.set(entity.id, marker);
    }
  }

  for (const [id, marker] of currentMarkers.entries()) {
    if (!newMarkerIds.has(id)) {
      marker.remove();
      currentMarkers.delete(id);
    }
  }
});

onUnmounted(() => {
  for (const marker of aircraftMarkers.value.values()) {
    marker.remove();
  }
  aircraftMarkers.value.clear();
});
</script>

<style>
.leaflet-tooltip-custom {
  font-family: "B612", sans-serif;
}

.aircraft_default svg {
  fill: #f9fd15;
}
.aircraft_selected svg {
  fill: #ff6464;
}

/* aircraft tooltip: not using v0.1 styles. */
.tooltip-grid {
  border-radius: 10px;
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 1rem;
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

/* ensure one tooltip visiable at a time, preventing clutter */
.leaflet-tooltip:not(:last-child) {
  display: none;
}
</style>
