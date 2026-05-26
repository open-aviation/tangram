import { describe, expect, it } from "vitest";
import { findTrajectorySampleIndexAtTime, generateTimedSegments } from "./trajectory";

describe("findTrajectorySampleIndexAtTime", () => {
  // ship162 ais timestamp are in seconds
  it("returns the rightmost sample at or before the requested time", () => {
    const points = [
      { timestamp: 10 },
      { timestamp: 20 },
      { timestamp: 20 },
      { timestamp: 30 }
    ];

    expect(findTrajectorySampleIndexAtTime(points, 20, point => point.timestamp)).toBe(
      2
    );
  });
});

describe("generateTimedSegments", () => {
  it("marks segments as invisible after the source trajectory ends", () => {
    const segments = Array.from(
      generateTimedSegments(
        [
          { timestamp: 10, position: [0, 0, 0] as const },
          { timestamp: 20, position: [1, 0, 0] as const },
          { timestamp: 30, position: [2, 0, 0] as const }
        ],
        {
          getPosition: point => [...point.position],
          getTimestamp: point => point.timestamp,
          getColor: () => [255, 0, 0] as [number, number, number],
          gapColor: [0, 0, 0] as [number, number, number],
          maxGapSeconds: 100
        }
      )
    );

    expect(segments).toHaveLength(2);
    expect(segments[0].visibleUntil).toBe(30);
    expect(segments[1].visibleUntil).toBe(30);
  });
});
