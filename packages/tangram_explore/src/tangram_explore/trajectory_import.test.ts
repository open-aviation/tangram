import { describe, expect, it } from "vitest";
import {
  extractTrajectoryJsonRows,
  isFlightRadar24FlightJson,
  rowsToTrajectories
} from "./trajectory_import";

describe("FlightRadar24 JSON imports", () => {
  it("extracts the track from an API response envelope", () => {
    const flightRadar24Json = {
      result: {
        response: {
          data: {
            flight: {
              identification: {
                number: { default: "AY1047" },
                callsign: "FIN8NP"
              },
              track: [
                {
                  latitude: 60.314777,
                  longitude: 24.973862,
                  altitude: { feet: 0 },
                  speed: { kts: 0 },
                  verticalSpeed: { fpm: 0 },
                  heading: 233,
                  timestamp: 1788433025
                },
                {
                  latitude: 60.314812,
                  longitude: 24.974081,
                  altitude: { feet: 25 },
                  speed: { kts: 3 },
                  verticalSpeed: { fpm: 128 },
                  heading: 234,
                  timestamp: 1788433072
                }
              ]
            }
          }
        }
      }
    };
    const rows = extractTrajectoryJsonRows(flightRadar24Json, "417c6ef2.json");

    expect(isFlightRadar24FlightJson(flightRadar24Json)).toBe(true);
    expect(rows).toEqual([
      {
        callsign: "FIN8NP",
        latitude: 60.314777,
        longitude: 24.973862,
        timestamp: 1788433025,
        altitude: 0,
        speed: 0,
        vertical_rate: 0,
        heading: 233,
        track: 233
      },
      {
        callsign: "FIN8NP",
        latitude: 60.314812,
        longitude: 24.974081,
        timestamp: 1788433072,
        altitude: 25,
        speed: 3,
        vertical_rate: 128,
        heading: 234,
        track: 234
      }
    ]);

    expect(isFlightRadar24FlightJson([{ latitude: 60, longitude: 25 }])).toBe(false);

    expect(
      rowsToTrajectories(rows ?? [], {
        idFields: ["callsign"],
        latitudeFields: ["latitude"],
        longitudeFields: ["longitude"],
        timestampFields: ["timestamp"],
        altitudeFields: ["altitude"],
        speedFields: ["speed"],
        headingFields: ["heading"],
        trackFields: ["track"],
        splitThresholdSeconds: 600,
        defaultProperties: { format: "trajectory-json" }
      })
    ).toMatchObject([
      {
        id: "FIN8NP",
        label: "FIN8NP",
        points: [
          { latitude: 60.314777, longitude: 24.973862, altitude: 0 },
          { latitude: 60.314812, longitude: 24.974081, altitude: 25 }
        ]
      }
    ]);
  });
});
