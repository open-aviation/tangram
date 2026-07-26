import type { MapBounds } from "@open-aviation/tangram-core/api";
import type { RouteResolution } from "./traffic";

export type RouteSegment = RouteResolution["route"]["features"][number];
export type RoutePoint = RouteResolution["points"]["features"][number];
export type RouteCoordinate = [number, number];

const EARTH_RADIUS_NM = 3440.065;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function canonicalLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function nearestLongitudeCopy(longitude: number, reference: number | null): number {
  return reference === null
    ? longitude
    : longitude + 360 * Math.round((reference - longitude) / 360);
}

function coordinateKey(coordinate: RouteCoordinate): string {
  return coordinate.join("|");
}

function greatCircleDistanceNm(start: RouteCoordinate, end: RouteCoordinate): number {
  const latitudeDelta = toRadians(end[1] - start[1]);
  const longitudeDelta = toRadians(
    canonicalLongitude(end[0]) - canonicalLongitude(start[0])
  );
  const startLatitude = toRadians(start[1]);
  const endLatitude = toRadians(end[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function greatCircleLeg(
  start: RouteCoordinate,
  end: RouteCoordinate
): RouteCoordinate[] {
  const lat1 = toRadians(start[1]);
  const lon1 = toRadians(canonicalLongitude(start[0]));
  const lat2 = toRadians(end[1]);
  const lon2 = toRadians(canonicalLongitude(end[0]));
  const angle = greatCircleDistanceNm(start, end) / EARTH_RADIUS_NM;

  if (angle < 1e-6 || Math.abs(Math.sin(angle)) < 1e-12) return [start, end];

  // Keep an interior vertex so a long leg remains visible when both endpoints leave view.
  const steps = Math.min(40, Math.max(2, Math.ceil(toDegrees(angle))));
  const sinAngle = Math.sin(angle);
  const path: RouteCoordinate[] = [start];
  let previousLongitude = start[0];

  for (let step = 1; step < steps; step += 1) {
    const fraction = step / steps;
    const startWeight = Math.sin((1 - fraction) * angle) / sinAngle;
    const endWeight = Math.sin(fraction * angle) / sinAngle;
    const x =
      startWeight * Math.cos(lat1) * Math.cos(lon1) +
      endWeight * Math.cos(lat2) * Math.cos(lon2);
    const y =
      startWeight * Math.cos(lat1) * Math.sin(lon1) +
      endWeight * Math.cos(lat2) * Math.sin(lon2);
    const z = startWeight * Math.sin(lat1) + endWeight * Math.sin(lat2);
    const latitude = toDegrees(Math.atan2(z, Math.hypot(x, y)));
    const longitude = nearestLongitudeCopy(
      canonicalLongitude(toDegrees(Math.atan2(y, x))),
      previousLongitude
    );
    path.push([longitude, latitude]);
    previousLongitude = longitude;
  }

  path.push(end);
  return path;
}

function greatCirclePath(coordinates: RouteCoordinate[]): RouteCoordinate[] {
  const first = coordinates[0];
  if (!first) return [];

  const path = [first];
  for (let index = 1; index < coordinates.length; index += 1) {
    path.push(...greatCircleLeg(coordinates[index - 1], coordinates[index]).slice(1));
  }
  return path;
}

function boundsFromCoordinates(coordinates: RouteCoordinate[]): MapBounds | null {
  const first = coordinates[0];
  if (!first) return null;

  let [minLon, minLat] = first;
  let [maxLon, maxLat] = first;
  for (const [longitude, latitude] of coordinates.slice(1)) {
    minLon = Math.min(minLon, longitude);
    minLat = Math.min(minLat, latitude);
    maxLon = Math.max(maxLon, longitude);
    maxLat = Math.max(maxLat, latitude);
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** A resolver leg prepared for display, with unwrapped geometry and cached distance. */
export class RouteLeg {
  private constructor(
    readonly feature: RouteSegment,
    readonly distanceNm: number
  ) {}

  static fromFeature(feature: RouteSegment, path: RouteCoordinate[]): RouteLeg {
    const start = feature.geometry.coordinates[0];
    const end = feature.geometry.coordinates.at(-1);
    const distanceNm = start && end ? greatCircleDistanceNm(start, end) : 0;
    return new RouteLeg(
      {
        ...feature,
        geometry: { ...feature.geometry, coordinates: path }
      },
      distanceNm
    );
  }
}

/**
 * Display geometry indexed exactly like resolver route features and extracted points.
 * Longitudes are unwrapped once.
 */
export class RouteGeometry {
  private constructor(
    readonly legs: RouteLeg[],
    readonly points: RoutePoint[],
    readonly bounds: MapBounds | null
  ) {}

  static fromResolution(resolution: RouteResolution): RouteGeometry {
    // repeated physical fixes intentionally stay on one map copy
    // TODO choose copies per occurrence if we support circumnavigation
    const displayedLongitudes = new Map<string, number>();
    let previousLongitude: number | null = null;

    // traffic.js emits field-15 segments in route order, including warning-classified gaps.
    const legs = resolution.route.features.map(feature => {
      const sourceCoordinates = feature.geometry.coordinates.map(coordinate => {
        const canonical: RouteCoordinate = [coordinate[0], coordinate[1]];
        const key = coordinateKey(canonical);
        const longitude =
          displayedLongitudes.get(key) ??
          nearestLongitudeCopy(canonical[0], previousLongitude);
        displayedLongitudes.set(key, longitude);
        previousLongitude = longitude;
        return [longitude, canonical[1]] as RouteCoordinate;
      });
      return RouteLeg.fromFeature(feature, greatCirclePath(sourceCoordinates));
    });

    const longitudes = legs.flatMap(leg =>
      leg.feature.geometry.coordinates.map(([longitude]) => longitude)
    );
    const routeCentre = longitudes.length
      ? (Math.min(...longitudes) + Math.max(...longitudes)) / 2
      : 0;

    const points = resolution.points.features.map(feature => {
      const canonical: RouteCoordinate = [
        feature.geometry.coordinates[0],
        feature.geometry.coordinates[1]
      ];
      const longitude =
        displayedLongitudes.get(coordinateKey(canonical)) ??
        nearestLongitudeCopy(canonical[0], routeCentre);
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: [longitude, canonical[1]] as RouteCoordinate
        }
      };
    });

    return new RouteGeometry(
      legs,
      points,
      boundsFromCoordinates(legs.flatMap(leg => leg.feature.geometry.coordinates))
    );
  }

  point(index: number): RoutePoint | null {
    return this.points[index] ?? null;
  }

  leg(index: number): RouteLeg | null {
    return this.legs[index] ?? null;
  }

  subsetBounds(pointIndices: number[], segmentIndices: number[]): MapBounds | null {
    const pointCoordinates = pointIndices.flatMap(index => {
      const point = this.point(index);
      return point ? [point.geometry.coordinates] : [];
    });
    const segmentCoordinates = segmentIndices.flatMap(
      index => this.leg(index)?.feature.geometry.coordinates ?? []
    );
    return boundsFromCoordinates([...pointCoordinates, ...segmentCoordinates]);
  }
}
