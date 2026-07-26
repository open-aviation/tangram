import type { Field15Element } from "traffic.js";
import type { MapBounds } from "@open-aviation/tangram-core/api";
import type {
  WorkspaceDatasetEntry,
  WorkspaceDatasetInput
} from "@open-aviation/tangram-core/api";
import { Field15Presentation } from "./field15Tokens";
import { canonicalLongitude, RouteGeometry } from "./geometry";
import type { RouteResolution } from "./traffic";

export const NAVAID_POINT_KIND = "tangram_navaid_point";
export const PLANNED_ROUTE_KIND = "tangram_navaid_planned_route";

export class ResolvedRoute {
  private constructor(
    readonly geometry: RouteGeometry,
    readonly presentation: Field15Presentation,
    readonly bounds: MapBounds | null
  ) {}

  static fromResolution(
    elements: Field15Element[],
    resolution: RouteResolution
  ): ResolvedRoute {
    const geometry = RouteGeometry.fromResolution(resolution);
    return new ResolvedRoute(
      geometry,
      Field15Presentation.fromElements(elements, resolution),
      geometry.bounds
    );
  }
}

type NavaidPointFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    ident: string;
    name?: string | null;
    kind?: string | null;
    source?: string | null;
    frequency?: number | null;
    elevation_ft?: number | null;
  };
};

export class NavaidPoint {
  private constructor(
    readonly ident: string,
    readonly name: string,
    readonly kind: string,
    readonly source: string | null,
    readonly latitude: number,
    readonly longitude: number,
    readonly frequency: number | null,
    readonly elevationFt: number | null
  ) {}

  static fromFeature(feature: NavaidPointFeature): NavaidPoint {
    const [longitude, latitude] = feature.geometry.coordinates;
    const properties = feature.properties;
    return new NavaidPoint(
      properties.ident,
      properties.name || properties.ident,
      properties.kind || "point",
      properties.source ?? null,
      latitude,
      canonicalLongitude(longitude),
      properties.frequency ?? null,
      properties.elevation_ft ?? null
    );
  }

  get bounds(): MapBounds {
    return {
      minLon: this.longitude,
      minLat: this.latitude,
      maxLon: this.longitude,
      maxLat: this.latitude
    };
  }
}

export interface NavaidPointPayload {
  type: "point";
  point: NavaidPoint;
}

export type PlannedRouteResolution =
  | { status: "resolving" }
  | { status: "resolved"; route: ResolvedRoute }
  | { status: "error"; message: string };

export interface PlannedRoutePayload {
  type: "route";
  expression: string;
  elements: Field15Element[];
  resolution: PlannedRouteResolution;
}

export type NavaidPointEntry = WorkspaceDatasetEntry<NavaidPointPayload> & {
  kind: typeof NAVAID_POINT_KIND;
};
export type PlannedRouteEntry = WorkspaceDatasetEntry<PlannedRoutePayload> & {
  kind: typeof PLANNED_ROUTE_KIND;
};
export type NavaidDatasetEntry = NavaidPointEntry | PlannedRouteEntry;

export type PlannedRouteInput = WorkspaceDatasetInput<PlannedRoutePayload> & {
  kind: typeof PLANNED_ROUTE_KIND;
};

function hasPayloadType(
  entry: WorkspaceDatasetEntry,
  type: NavaidPointPayload["type"] | PlannedRoutePayload["type"]
): boolean {
  return (
    typeof entry.payload === "object" &&
    entry.payload !== null &&
    "type" in entry.payload &&
    entry.payload.type === type
  );
}

export function isNavaidPointEntry(
  entry: WorkspaceDatasetEntry
): entry is NavaidPointEntry {
  return entry.kind === NAVAID_POINT_KIND && hasPayloadType(entry, "point");
}

export function isPlannedRouteEntry(
  entry: WorkspaceDatasetEntry
): entry is PlannedRouteEntry {
  return entry.kind === PLANNED_ROUTE_KIND && hasPayloadType(entry, "route");
}

export function isNavaidDatasetEntry(
  entry: WorkspaceDatasetEntry
): entry is NavaidDatasetEntry {
  return isNavaidPointEntry(entry) || isPlannedRouteEntry(entry);
}
