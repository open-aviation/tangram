import type { Jet1090Aircraft } from ".";

/** Live geometry has its own measured time and exclusive expiry, never lastseen. */
export function hasFreshPosition(state: Jet1090Aircraft, nowMs = Date.now()): boolean {
  const {
    latitude,
    longitude,
    position_timestamp: time,
    position_expires_at: expiry
  } = state;
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    time != null &&
    expiry != null &&
    Number.isSafeInteger(time) &&
    Number.isSafeInteger(expiry) &&
    time >= 0 &&
    time <= nowMs * 1_000 &&
    nowMs * 1_000 < expiry
  );
}

/** Held coordinates do not become new trajectory measurements as activity arrives. */
export function livePositionPoint(
  state: Jet1090Aircraft,
  lastTimestamp?: number,
  nowMs = Date.now()
): (Jet1090Aircraft & { timestamp: number }) | undefined {
  if (!hasFreshPosition(state, nowMs)) return;
  const timestamp = state.position_timestamp! / 1_000_000;
  if (lastTimestamp != null && timestamp - lastTimestamp <= 0.5) return;
  return { ...state, timestamp };
}
