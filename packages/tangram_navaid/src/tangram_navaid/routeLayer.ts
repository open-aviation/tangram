// Draws a resolved Field 15 route on the map as deck.gl layers and frames it.
//
// - Route segments (LineStrings) in the "routes" slot, coloured by type.
// - Waypoint markers in the "highlights" slot — no persistent text, but a hover
//   tooltip (the same "nice box" as navaids/fixes) shows each waypoint's info.
// - Clicking a segment or a waypoint opens a remove menu for the whole route.
//
// Many routes may be on the map at once; each gets a unique `itemId`.

import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import type {
  RouteResolution,
  LineStringFeature,
  PointFeature
} from "./traffic";
import type { NavPointInfo } from "./tooltip";
import {
  mountPointTooltip,
  showPointTooltip,
  hidePointTooltip
} from "./tooltip";
import { openRemoveMenu } from "./removeMenu";

type RGB = [number, number, number];

const AIRWAY_COLOR: RGB = [217, 155, 61];
const SEGMENT_COLORS: Record<string, RGB> = {
  dct: [102, 102, 102],
  nat: [47, 95, 152],
  unresolved: [157, 63, 54]
};
const WAYPOINT_COLOR: RGB = [255, 140, 0];

interface RoutePointProperties {
  ident: string;
  kind: string | null;
}

function segmentColor(feature: LineStringFeature): RGB {
  const type = String(feature.properties?.segment_type ?? "").toLowerCase();
  return SEGMENT_COLORS[type] ?? AIRWAY_COLOR;
}

function canonicalLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function waypointInfo(
  feature: PointFeature<RoutePointProperties>
): NavPointInfo {
  const [lon, lat] = feature.geometry.coordinates;
  return {
    ident: feature.properties?.ident ?? "?",
    kind: feature.properties?.kind ?? "point",
    lat,
    // Render on an unwrapped world copy, but display canonical coordinates.
    lon: canonicalLongitude(lon)
  };
}

/**
 * Put every route coordinate on the nearest world copy of the preceding one.
 * This is the same antimeridian strategy as planned-route-encoding.qmd:
 * repeated/shared coordinates keep one displayed longitude, and waypoint
 * markers are shifted onto the same copy as their route endpoints.
 */
function unwrapRouteGeometry(resolution: RouteResolution): {
  segments: LineStringFeature[];
  points: PointFeature<RoutePointProperties>[];
} {
  const displayedLongitude = new Map<string, number>();
  const coordinateKey = ([lon, lat]: [number, number]) =>
    `${Number(lon).toFixed(8)}|${Number(lat).toFixed(8)}`;
  const nearestCopy = (longitude: number, reference: number) =>
    Number.isFinite(reference)
      ? longitude + 360 * Math.round((reference - longitude) / 360)
      : longitude;

  let previousLongitude = Number.NaN;
  const segments = (resolution.route.features ?? []).map(feature => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map(coordinate => {
        const canonical: [number, number] = [
          Number(coordinate[0]),
          Number(coordinate[1])
        ];
        const key = coordinateKey(canonical);
        const known = displayedLongitude.get(key);
        const longitude =
          known ?? nearestCopy(canonical[0], previousLongitude);
        displayedLongitude.set(key, longitude);
        previousLongitude = longitude;
        return [longitude, canonical[1]] as [number, number];
      })
    },
    properties: { ...feature.properties }
  }));

  const displayedLongitudes = [...displayedLongitude.values()];
  const routeCentre = displayedLongitudes.length
    ? (Math.min(...displayedLongitudes) +
        Math.max(...displayedLongitudes)) /
      2
    : 0;

  const points = (resolution.points.features ?? []).map(feature => {
    const canonical: [number, number] = [
      Number(feature.geometry.coordinates[0]),
      Number(feature.geometry.coordinates[1])
    ];
    const longitude =
      displayedLongitude.get(coordinateKey(canonical)) ??
      nearestCopy(canonical[0], routeCentre);
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: [longitude, canonical[1]] as [number, number]
      },
      properties: { ...feature.properties }
    };
  });

  return { segments, points };
}

export function drawRoute(
  api: TangramApi,
  pluginId: string,
  itemId: string,
  resolution: RouteResolution,
  onRemove: () => void
): Disposable {
  const map = api.map.getMapInstance();
  const container = map.getContainer();
  const tooltip = mountPointTooltip(container);

  const { segments, points } = unwrapRouteGeometry(resolution);

  const openRouteMenu = (x: number, y: number) => {
    openRemoveMenu({
      container,
      x,
      y,
      title: itemId,
      onRemove
    });
  };

  const routeLayer = new GeoJsonLayer<LineStringFeature>({
    id: `tangram-navaid-route-${itemId}`,
    data: { type: "FeatureCollection", features: segments },
    visible: true,
    pickable: true,
    stroked: false,
    filled: false,
    lineWidthMinPixels: 3,
    getLineColor: (feature: unknown) =>
      segmentColor(feature as LineStringFeature),
    onHover: (info: { object?: unknown }) => {
      map.getCanvas().style.cursor = info.object ? "pointer" : "";
      if (!info.object) hidePointTooltip(tooltip);
    },
    onClick: ({ x, y }) => openRouteMenu(x, y)
  });

  const waypointLayer = new ScatterplotLayer<
    PointFeature<RoutePointProperties>
  >({
    id: `tangram-navaid-waypoints-${itemId}`,
    data: points,
    visible: true,
    pickable: true,
    radiusMinPixels: 4,
    radiusMaxPixels: 8,
    getRadius: 6,
    getFillColor: WAYPOINT_COLOR,
    getPosition: (feature: PointFeature<RoutePointProperties>) =>
      feature.geometry.coordinates,
    onHover: ({ x, y, object }) => {
      if (object) {
        showPointTooltip(tooltip, waypointInfo(object), x, y, container);
        map.getCanvas().style.cursor = "pointer";
      } else {
        hidePointTooltip(tooltip);
        map.getCanvas().style.cursor = "";
      }
    },
    onClick: ({ x, y }) => openRouteMenu(x, y)
  });

  const disposables = [
    api.map.addLayer(routeLayer, { pluginId, slot: "routes" }),
    api.map.addLayer(waypointLayer, { pluginId, slot: "highlights" })
  ];

  fitRouteBounds(map, segments);

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
      tooltip.remove();
      map.getCanvas().style.cursor = "";
    }
  };
}

/** Frame the already-unwrapped route geometry. */
function fitRouteBounds(
  map: ReturnType<TangramApi["map"]["getMapInstance"]>,
  segments: LineStringFeature[]
): void {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let count = 0;

  for (const segment of segments) {
    for (const [lon, lat] of segment.geometry.coordinates) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      count += 1;
    }
  }

  if (count === 0) return;

  if (minLon === maxLon && minLat === maxLat) {
    map.flyTo({ center: [minLon, minLat], zoom: 9 });
    return;
  }

  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat]
    ],
    { padding: 60 }
  );
}
