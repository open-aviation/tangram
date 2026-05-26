import { oklchToDeckGLColor, resolveBearing } from "@open-aviation/tangram-core/utils";
import type { Position3D } from "@open-aviation/tangram-core/trajectory";
import type { TrailColorOptions } from "./store";

export const FEET_TO_METERS = 0.3048;
export const MAX_GAP_SECONDS = 600;

export type Color = [number, number, number, number];

export const GAP_COLOR: Color = [180, 180, 180, 128];

export interface PositionData {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  groundspeed?: number;
  vertical_rate?: number;
  track?: number;
  heading?: number;
}

export function hexToRgb(hex: string): Color {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255]
    : [128, 0, 128, 255];
}

export interface TrailConfig {
  trailType: "line" | "curtain";
  trailColor: string | TrailColorOptions;
  trailAlpha: number;
  enable3d: boolean;
}

export function getPointColor(p: PositionData, config: TrailConfig): Color {
  const { trailColor, trailAlpha } = config;
  const a = Math.round(trailAlpha * 255);

  if (typeof trailColor === "string") {
    const rgb = hexToRgb(trailColor);
    return [rgb[0], rgb[1], rgb[2], a];
  }

  const { by_attribute, min, max } = trailColor;
  let value = 0;
  let rangeMin = min ?? 0;
  let rangeMax = max ?? 1;
  let hueMin = 0;
  let hueMax = 0;

  if (by_attribute === "altitude") {
    value = p.altitude || 0;
    rangeMin = min ?? 0;
    rangeMax = max ?? 45000;
    hueMin = 270;
    hueMax = 0;
  } else if (by_attribute === "groundspeed") {
    value = p.groundspeed || 0;
    rangeMin = min ?? 0;
    rangeMax = max ?? 600;
    hueMin = 240;
    hueMax = 0;
  } else if (by_attribute === "vertical_rate") {
    value = p.vertical_rate || 0;
    if (Math.abs(value) < 100) return [128, 128, 128, a];
    const intensity = Math.min(1, Math.abs(value) / (max ?? 2000));
    if (value > 0) {
      return oklchToDeckGLColor(0.6 + intensity * 0.2, 0.1 + intensity * 0.15, 260, a);
    } else {
      return oklchToDeckGLColor(0.6 + intensity * 0.1, 0.1 + intensity * 0.15, 30, a);
    }
  } else if (by_attribute === "track") {
    value = resolveBearing(p.track, p.heading) ?? 0;
    return oklchToDeckGLColor(0.65, 0.2, value, a);
  }

  // lerp for other modes (altitude, groundspeed)
  const t = Math.max(0, Math.min(1, (value - rangeMin) / (rangeMax - rangeMin)));
  const h = hueMin + t * (hueMax - hueMin);
  return oklchToDeckGLColor(0.65, 0.2, h, a);
}

export function getPosition(
  p: PositionData,
  enable3d: boolean,
  prevAlt: { value: number | null }
): Position3D | null {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;

  const isSurfacePositionSample = p.altitude == null && p.groundspeed != null;

  let alt = p.altitude;
  if (isSurfacePositionSample) {
    alt = 0;
  } else if (alt == null && prevAlt.value != null) {
    alt = prevAlt.value;
  }
  if (alt != null) prevAlt.value = alt;
  const z = !enable3d ? 0 : (alt || 0) * FEET_TO_METERS;
  return [p.longitude!, p.latitude!, z];
}
