import type { Field15Element, Field15Modifier } from "traffic.js";
import type { RouteResolution } from "./traffic";
import { canonicalLongitude } from "./geometry";

export type Field15TokenCategory =
  "speed-level" | "procedure" | "point" | "direct" | "airway" | "track" | "flag";

type Field15PointReference =
  { kind: "name"; value: string } | { kind: "coordinates"; value: [number, number] };

type RouteSegment = RouteResolution["route"]["features"][number];
type RoutePoint = RouteResolution["points"]["features"][number];
type RouteCoordinate = [number, number];

// NOTE: copying the formatter from the book: https://github.com/open-aviation/aviationbook/blob/927a79b/chapters/data_sources/planned-route-encoding.qmd
// for now, but we may want to move it into Rust. See:
// Parser: https://github.com/xoolive/thrust/blob/6f278a4/crates/thrust/src/data/field15.rs
// Spec: https://eur-lex.europa.eu/eli/reg_impl/2023/1772/oj/eng (ICAO Doc 4444 is paywalled)

function padField15Number(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, "0");
}

function speedLabel(speed: Field15Modifier["speed"]): string {
  if (!speed) return "";
  if ("kts" in speed) return `N${padField15Number(speed.kts, 4)}`;
  if ("km/h" in speed) return `K${padField15Number(speed["km/h"], 4)}`;
  return `M${padField15Number(Math.round(speed.Mach * 100), 3)}`;
}

function altitudeLabel(altitude: Field15Modifier["altitude"]): string {
  if (!altitude) return "";
  if (altitude === "VFR") return "VFR";
  if ("FL" in altitude) return `F${padField15Number(altitude.FL, 3)}`;
  if ("S" in altitude) return `S${padField15Number(altitude.S, 4)}`;
  if ("ft" in altitude) {
    // NOTE: upstream describes "A followed by 4 digits" but spec says 3 digits
    return `A${padField15Number(Math.round(altitude.ft / 100), 3)}`;
  }
  // NOTE: trafficjs exposes encoded Mdddd as `m` (count of tens of meters)
  // but the qmd incorrectly divides it by 10.
  return `M${padField15Number(altitude.m, 4)}`;
}

function coordinateLabel([latitude, longitude]: [number, number]): string {
  return `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"} ${Math.abs(
    longitude
  ).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;
}

function field15PointLabel(element: Field15Element): string {
  if (typeof element === "string") return element;
  if ("waypoint" in element) return element.waypoint;
  if ("aerodrome" in element) return element.aerodrome;
  if ("coords" in element) return coordinateLabel(element.coords);
  return "point";
}

export class Field15Token {
  readonly pointIndices: number[] = [];
  readonly segmentIndices: number[] = [];
  readonly warnings: string[] = [];

  private constructor(
    readonly index: number,
    readonly category: Field15TokenCategory,
    readonly label: string,
    readonly type: string,
    private readonly pointReference?: Field15PointReference,
    readonly connector?: string
  ) {}

  static fromElement(element: Field15Element, index: number): Field15Token {
    if (typeof element === "string") {
      return element === "DCT"
        ? new Field15Token(index, "direct", element, "Direct", undefined, element)
        : new Field15Token(index, "flag", element, "Flag");
    }

    if (
      "speed" in element ||
      "altitude" in element ||
      "altitude_cruise_to" in element
    ) {
      // NOTE: format structured fields directly. Upstream Display currently emits
      // non-ICAO Mach text and drops the cruise-climb target altitude.
      const label = `${element.cruise_climb ? "C/" : ""}${speedLabel(
        element.speed
      )}${altitudeLabel(element.altitude)}${altitudeLabel(element.altitude_cruise_to)}`;
      return new Field15Token(index, "speed-level", label || "level", "Speed / level");
    }
    // NOTE: upstream may classify a four-letter en-route point as an aerodrome.
    // both variants remain point anchors here, do not infer aerodrome semantics.
    if ("waypoint" in element) {
      return new Field15Token(index, "point", element.waypoint, "Waypoint", {
        kind: "name",
        value: element.waypoint
      });
    }
    if ("aerodrome" in element) {
      return new Field15Token(index, "point", element.aerodrome, "Aerodrome", {
        kind: "name",
        value: element.aerodrome
      });
    }
    if ("coords" in element) {
      return new Field15Token(
        index,
        "point",
        coordinateLabel(element.coords),
        "Coordinate",
        { kind: "coordinates", value: element.coords }
      );
    }
    if ("point_bearing_distance" in element) {
      const value = element.point_bearing_distance;
      const label = `${field15PointLabel(value.point)}${padField15Number(
        value.bearing,
        3
      )}${padField15Number(value.distance, 3)}`;
      return new Field15Token(index, "point", label, "Bearing / distance", {
        kind: "name",
        value: label
      });
    }
    // NOTE: SID/STAR versus airway classification is position-sensitive upstream
    // once the parser emits the wrong connector variant, the UI cannot recover intent
    if ("airway" in element) {
      return new Field15Token(
        index,
        "airway",
        element.airway,
        "ATS route",
        undefined,
        element.airway
      );
    }
    if ("SID" in element) {
      return new Field15Token(
        index,
        "procedure",
        element.SID,
        "SID",
        undefined,
        element.SID
      );
    }
    if ("STAR" in element) {
      return new Field15Token(
        index,
        "procedure",
        element.STAR,
        "STAR",
        undefined,
        element.STAR
      );
    }
    if ("NAT" in element) {
      return new Field15Token(
        index,
        "track",
        element.NAT,
        "Organised track",
        undefined,
        element.NAT
      );
    }
    if ("PTS" in element) {
      return new Field15Token(
        index,
        "track",
        element.PTS,
        "Organised track",
        undefined,
        element.PTS
      );
    }
    if ("STAY" in element) {
      const minutes = element.STAY.minutes;
      return new Field15Token(
        index,
        "flag",
        "STAY",
        minutes === null ? "Stay" : `Stay · ${minutes} min`
      );
    }
    return new Field15Token(index, "flag", "flag", "Flag");
  }

  matchesEndpoint(name: string | null, coordinates: RouteCoordinate): boolean {
    if (!this.pointReference) return false;
    if (this.pointReference.kind === "name") {
      return canonicalRouteCode(name) === canonicalRouteCode(this.pointReference.value);
    }
    const [latitude, longitude] = this.pointReference.value;
    return sameRoutePosition([longitude, latitude], coordinates);
  }

  matchesSegment(segment: RouteSegment): boolean {
    if (!this.connector) return false;
    if (this.category === "direct") {
      return (
        canonicalRouteCode(segment.properties.segment_type) === "DCT" ||
        canonicalRouteCode(segment.properties.connector) === "DCT"
      );
    }
    const connector = canonicalRouteCode(this.connector);
    return (
      canonicalRouteCode(segment.properties.connector) === connector ||
      canonicalRouteCode(segment.properties.name) === connector
    );
  }

  addPointIndices(indices: number[]): void {
    this.pointIndices.push(...indices);
  }

  addSegmentIndices(indices: number[]): void {
    this.segmentIndices.push(...indices);
  }

  addWarning(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

type Field15PresentationParts = readonly [
  Field15Token[],
  Map<number, number[]>,
  Map<number, number[]>
];

/**
 * Cross-indexes parsed token occurrences with resolver point/leg occurrences.
 * Its warnings describe geometry association.
 */
export class Field15Presentation {
  private constructor(
    readonly tokens: Field15Token[],
    readonly pointTokenIndices: Map<number, number[]>,
    readonly segmentTokenIndices: Map<number, number[]>
  ) {}

  static fromElements(
    elements: Field15Element[],
    resolution: RouteResolution | null = null,
    failure: string | null = null
  ): Field15Presentation {
    const [tokens, pointTokenIndices, segmentTokenIndices] = buildField15Presentation(
      elements,
      resolution,
      failure
    );
    return new Field15Presentation(tokens, pointTokenIndices, segmentTokenIndices);
  }

  static routeLabel(elements: Field15Element[]): string {
    const tokens = elements.map((element, index) =>
      Field15Token.fromElement(element, index)
    );
    const points = tokens.filter(token => token.category === "point");
    if (points.length >= 2) {
      return `${points[0].label} ❯ ${points[points.length - 1].label}`;
    }
    const anchors = tokens.filter(
      token => token.category === "point" || token.category === "procedure"
    );
    return anchors.length
      ? anchors.map(token => token.label).join(" ❯ ")
      : "planned route";
  }
}

class RouteEndpoint {
  private constructor(
    readonly name: string | null,
    readonly coordinates: RouteCoordinate
  ) {}

  static fromSegment(segment: RouteSegment, side: "start" | "end"): RouteEndpoint {
    const coordinates =
      side === "start"
        ? segment.geometry.coordinates[0]
        : segment.geometry.coordinates.at(-1)!;
    return new RouteEndpoint(
      side === "start" ? segment.properties.start_name : segment.properties.end_name,
      [coordinates[0], coordinates[1]]
    );
  }
}

/**
 * A synthesized route occurrence boundary. traffic.js returns ordered segments but
 * no stable occurrence id. Coordinate continuity is identity and names are aliases.
 */
class RouteJunction {
  private constructor(
    readonly aliases: RouteEndpoint[],
    readonly beforeSegment: number | null,
    private afterSegmentIndex: number | null
  ) {}

  static fromSegments(segments: RouteSegment[]): RouteJunction[] {
    const junctions: RouteJunction[] = [];
    for (const [segmentIndex, segment] of segments.entries()) {
      const start = RouteEndpoint.fromSegment(segment, "start");
      const previous = junctions.at(-1);
      if (previous?.containsPosition(start.coordinates)) {
        previous.appendAlias(start, segmentIndex);
      } else {
        junctions.push(new RouteJunction([start], null, segmentIndex));
      }
      junctions.push(
        new RouteJunction(
          [RouteEndpoint.fromSegment(segment, "end")],
          segmentIndex,
          null
        )
      );
    }
    return junctions;
  }

  get afterSegment(): number | null {
    return this.afterSegmentIndex;
  }

  containsPosition(coordinates: RouteCoordinate): boolean {
    return this.aliases.some(alias =>
      sameRoutePosition(alias.coordinates, coordinates)
    );
  }

  matchesToken(token: Field15Token): boolean {
    return this.aliases.some(alias =>
      token.matchesEndpoint(alias.name, alias.coordinates)
    );
  }

  resolvedPointIndices(points: RoutePoint[], token: Field15Token): number[] {
    return points.flatMap((point, index) => {
      const coordinates: RouteCoordinate = [
        point.geometry.coordinates[0],
        point.geometry.coordinates[1]
      ];
      return token.matchesEndpoint(point.properties.ident, coordinates) &&
        this.containsPosition(coordinates)
        ? [index]
        : [];
    });
  }

  private appendAlias(endpoint: RouteEndpoint, afterSegment: number): void {
    this.aliases.push(endpoint);
    this.afterSegmentIndex = afterSegment;
  }
}

/** traffic.js preserves source casing and uses null for absent route metadata. */
function canonicalRouteCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

const ROUTE_POSITION_EPSILON = 1e-4;

function sameRoutePosition(left: RouteCoordinate, right: RouteCoordinate): boolean {
  return (
    Math.abs(canonicalLongitude(left[0] - right[0])) < ROUTE_POSITION_EPSILON &&
    Math.abs(left[1] - right[1]) < ROUTE_POSITION_EPSILON
  );
}

export const APPROXIMATE_TRACK_WARNING = "approximate track";

export function isApproximateTrackSegment(segment: {
  properties: { segment_type: string | null };
}): boolean {
  const segmentType = canonicalRouteCode(segment.properties.segment_type);
  return segmentType === "NAT" || segmentType === "PTS";
}

/** Upstream "unresolved" segments may still contain useful drawable geometry. */
export function isRouteWarningSegment(segment: {
  properties: { segment_type: string | null };
}): boolean {
  return canonicalRouteCode(segment.properties.segment_type) === "UNRESOLVED";
}

function pointTokenBefore(tokens: Field15Token[], index: number): Field15Token | null {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (tokens[current].category === "point") return tokens[current];
  }
  return null;
}

function pointTokenAfter(tokens: Field15Token[], index: number): Field15Token | null {
  for (let current = index + 1; current < tokens.length; current += 1) {
    if (tokens[current].category === "point") return tokens[current];
  }
  return null;
}

/**
 * With one missing anchor, keep the side that is known. This preserves matching
 * geometry returned by traffic.js while a separate warning names the missing point.
 */
function boundedSegmentIndices(
  junctions: RouteJunction[],
  segmentCount: number,
  startJunction?: number,
  endJunction?: number
): number[] {
  if (startJunction === undefined && endJunction === undefined) return [];
  const firstSegmentIndex =
    startJunction === undefined ? 0 : junctions[startJunction].afterSegment;
  const lastSegmentIndex =
    endJunction === undefined ? segmentCount - 1 : junctions[endJunction].beforeSegment;
  if (
    firstSegmentIndex === null ||
    lastSegmentIndex === null ||
    firstSegmentIndex > lastSegmentIndex
  ) {
    return [];
  }
  return Array.from(
    { length: lastSegmentIndex - firstSegmentIndex + 1 },
    (_, offset) => firstSegmentIndex + offset
  );
}

// SID and STAR tokens may legitimately omit one adjacent field-15 point.
function procedureSegments(
  token: Field15Token,
  tokens: Field15Token[],
  segments: RouteSegment[],
  junctions: RouteJunction[],
  junctionByToken: Map<number, number>
): number[] {
  const previousPointToken = pointTokenBefore(tokens, token.index);
  const followingPointToken = pointTokenAfter(tokens, token.index);
  const previousJunction = previousPointToken
    ? junctionByToken.get(previousPointToken.index)
    : undefined;
  const nextJunction = followingPointToken
    ? junctionByToken.get(followingPointToken.index)
    : undefined;
  const firstSegmentIndex =
    previousJunction === undefined ? 0 : junctions[previousJunction].afterSegment;
  const lastSegmentIndex =
    nextJunction === undefined
      ? segments.length - 1
      : junctions[nextJunction].beforeSegment;
  if (
    firstSegmentIndex === null ||
    lastSegmentIndex === null ||
    firstSegmentIndex > lastSegmentIndex
  ) {
    return [];
  }

  const direction = token.type === "SID" ? -1 : 1;
  let index = direction > 0 ? firstSegmentIndex : lastSegmentIndex;
  while (
    index >= firstSegmentIndex &&
    index <= lastSegmentIndex &&
    !token.matchesSegment(segments[index])
  ) {
    index += direction;
  }

  const result: number[] = [];
  while (
    index >= firstSegmentIndex &&
    index <= lastSegmentIndex &&
    token.matchesSegment(segments[index])
  ) {
    if (direction > 0) result.push(index);
    else result.unshift(index);
    index += direction;
  }
  return result;
}

function recordTokenIndex(
  map: Map<number, number[]>,
  key: number,
  index: number
): void {
  const indices = map.get(key);
  if (indices) indices.push(index);
  else map.set(key, [index]);
}

function buildField15Presentation(
  elements: Field15Element[],
  resolution: RouteResolution | null = null,
  failure: string | null = null
): Field15PresentationParts {
  // NOTE: parseField15 may accept malformed tokens, misclassify ambiguous tokens,
  // or omit invalid coordinates. Preserve its returned order; do not imply validation.
  const tokens = elements.map((element, index) =>
    Field15Token.fromElement(element, index)
  );
  const pointTokenIndices = new Map<number, number[]>();
  const segmentTokenIndices = new Map<number, number[]>();

  if (!resolution) {
    if (failure) {
      for (const token of tokens) {
        if (token.category === "point" || token.connector) {
          token.addWarning(`resolution failed: ${failure}`);
        }
      }
    }
    return [tokens, pointTokenIndices, segmentTokenIndices];
  }

  const segments = resolution.route.features;
  const junctions = RouteJunction.fromSegments(segments);
  const junctionByToken = new Map<number, number>();
  let nextJunctionIndex = 0;

  for (const token of tokens) {
    if (token.category !== "point") continue;
    const junctionIndex = junctions.findIndex(
      (junction, index) => index >= nextJunctionIndex && junction.matchesToken(token)
    );
    if (junctionIndex === -1) {
      token.addWarning("point not found");
      continue;
    }

    nextJunctionIndex = junctionIndex + 1;
    junctionByToken.set(token.index, junctionIndex);
    const pointIndices = junctions[junctionIndex].resolvedPointIndices(
      resolution.points.features,
      token
    );
    token.addPointIndices(pointIndices);
    if (pointIndices.length === 0) {
      token.addWarning("map point unavailable");
    }
    for (const pointIndex of pointIndices) {
      recordTokenIndex(pointTokenIndices, pointIndex, token.index);
    }
  }

  for (const token of tokens) {
    if (!token.connector) continue;

    if (token.category === "procedure") {
      token.addSegmentIndices(
        procedureSegments(token, tokens, segments, junctions, junctionByToken)
      );
      if (token.segmentIndices.length === 0) {
        token.addWarning("procedure not found");
      }
    } else {
      const previousPointToken = pointTokenBefore(tokens, token.index);
      const followingPointToken = pointTokenAfter(tokens, token.index);
      const startJunction = previousPointToken
        ? junctionByToken.get(previousPointToken.index)
        : undefined;
      const endJunction = followingPointToken
        ? junctionByToken.get(followingPointToken.index)
        : undefined;
      const missingPoints: string[] = [];
      if (!previousPointToken) missingPoints.push("previous point");
      else if (startJunction === undefined)
        missingPoints.push(previousPointToken.label);
      if (!followingPointToken) missingPoints.push("following point");
      else if (endJunction === undefined)
        missingPoints.push(followingPointToken.label);

      if (missingPoints.length > 0) {
        token.addWarning(
          `missing ${missingPoints.length === 1 ? "point" : "points"}: ${missingPoints.join(
            ", "
          )}`
        );
      }

      const candidateSegmentIndices = boundedSegmentIndices(
        junctions,
        segments.length,
        startJunction,
        endJunction
      );
      const matchingSegmentIndices = candidateSegmentIndices.filter(index =>
        token.matchesSegment(segments[index])
      );
      const associatedSegmentIndices: number[] = [];
      if (startJunction !== undefined && endJunction !== undefined) {
        associatedSegmentIndices.push(...candidateSegmentIndices);
      } else if (startJunction !== undefined) {
        for (const index of candidateSegmentIndices) {
          if (!token.matchesSegment(segments[index])) break;
          associatedSegmentIndices.push(index);
        }
      } else if (endJunction !== undefined) {
        for (let offset = candidateSegmentIndices.length - 1; offset >= 0; offset -= 1) {
          const index = candidateSegmentIndices[offset];
          if (!token.matchesSegment(segments[index])) break;
          associatedSegmentIndices.unshift(index);
        }
      }
      token.addSegmentIndices(associatedSegmentIndices);

      if (candidateSegmentIndices.length === 0) {
        const resolvedAnchorLabels = [
          startJunction === undefined ? null : previousPointToken?.label,
          endJunction === undefined ? null : followingPointToken?.label
        ].filter((label): label is string => !!label);
        token.addWarning(
          resolvedAnchorLabels.length
            ? `geometry not found near ${resolvedAnchorLabels.join(" and ")}`
            : "geometry not found"
        );
      } else if (
        matchingSegmentIndices.length !== candidateSegmentIndices.length &&
        missingPoints.length === 0
      ) {
        token.addWarning(
          `geometry mismatch: ${previousPointToken!.label}–${followingPointToken!.label}`
        );
      } else if (associatedSegmentIndices.length === 0) {
        token.addWarning("geometry not found");
      }
    }

    for (const segmentIndex of token.segmentIndices) {
      recordTokenIndex(segmentTokenIndices, segmentIndex, token.index);
    }
    if (token.segmentIndices.some(index => isRouteWarningSegment(segments[index]))) {
      token.addWarning("partially resolved");
    }
    if (
      token.category === "track" &&
      token.segmentIndices.some(index => isApproximateTrackSegment(segments[index]))
    ) {
      token.addWarning(APPROXIMATE_TRACK_WARNING);
    }
  }

  return [tokens, pointTokenIndices, segmentTokenIndices];
}
