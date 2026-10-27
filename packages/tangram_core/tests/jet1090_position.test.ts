import { describe, expect, it } from "vitest";
import type { Jet1090Aircraft } from "../../tangram_jet1090/src/tangram_jet1090";
import {
  hasFreshPosition,
  livePositionPoint
} from "../../tangram_jet1090/src/tangram_jet1090/live_position";

const fix: Jet1090Aircraft = {
  icao24: "40621d",
  lastseen: 1_001_000_000,
  count: 1,
  latitude: 43.5,
  longitude: 1.5,
  position_timestamp: 1_000_000_000,
  position_expires_at: 1_020_000_000
};

describe("validated live positions", () => {
  it("uses actual fix time, not aircraft activity", () => {
    expect(livePositionPoint(fix, undefined, 1_001_000)?.timestamp).toBe(1000);
    const activity = { ...fix, lastseen: 1_010_000_000, count: 99 };
    expect(livePositionPoint(activity, 1000, 1_010_000)).toBeUndefined();
    expect(activity.position_expires_at).toBe(fix.position_expires_at);
  });
  it("appends only newer fixes while retaining existing sampling", () => {
    const updated = {
      ...fix,
      position_timestamp: 1_001_000_000,
      position_expires_at: 1_021_000_000
    };
    expect(livePositionPoint(updated, 1000, 1_002_000)?.timestamp).toBe(1001);
    expect(livePositionPoint(fix, 1001, 1_002_000)).toBeUndefined();
    expect(livePositionPoint(fix, 999.5, 1_002_000)).toBeUndefined();
  });
  it("expires geometry at the deadline even without new snapshots", () => {
    expect(hasFreshPosition(fix, 1_019_999)).toBe(true);
    expect(hasFreshPosition(fix, 1_020_000)).toBe(false);
    expect(livePositionPoint(fix, undefined, 1_020_000)).toBeUndefined();
  });
  it("never invents a measurement time for legacy or incomplete snapshots", () => {
    expect(
      livePositionPoint({ ...fix, position_timestamp: undefined }, undefined, 1_001_000)
    ).toBeUndefined();
    expect(hasFreshPosition({ ...fix, longitude: undefined }, 1_001_000)).toBe(false);
    expect(
      hasFreshPosition({ ...fix, position_expires_at: undefined }, 1_001_000)
    ).toBe(false);
  });
  it("rejects future, nonfinite and out-of-range geometry", () => {
    expect(hasFreshPosition(fix, 999_000)).toBe(false);
    for (const latitude of [NaN, Infinity, 90.1])
      expect(hasFreshPosition({ ...fix, latitude }, 1_001_000)).toBe(false);
    expect(hasFreshPosition({ ...fix, longitude: 180.1 }, 1_001_000)).toBe(false);
  });
});
