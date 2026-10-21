import { describe, expect, it } from "vitest";
import {
  acceptsFlightRadar24Json,
  parseFlightRadar24Json
} from "./imported_trajectory";

const flightRadar24Json = {
  result: {
    response: {
      data: {
        flight: {
          identification: {
            id: "417c6ef2",
            number: { default: "AY1047" },
            callsign: "FIN8NP"
          },
          aircraft: {
            model: { code: "AT75" },
            identification: { modes: "4601F6", registration: "OH-ATI" }
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

const file = {
  metadata: {
    name: "417c6ef2.json",
    extension: ".json",
    mediaType: "application/json"
  },
  getJson: async () => flightRadar24Json
};

describe("FlightRadar24 JSON imports", () => {
  it("dispatches a recognized flight to the aircraft-history renderer", async () => {
    expect(await acceptsFlightRadar24Json(file as never)).toBe(true);

    await expect(parseFlightRadar24Json(file as never)).resolves.toMatchObject([
      {
        kind: "jet1090_imported_history",
        label: "417c6ef2.json",
        timeRange: { start: 1788433025, stop: 1788433072 },
        payload: {
          recordCount: 2,
          flights: [
            [
              {
                icao24: "4601f6",
                callsign: "FIN8NP",
                registration: "OH-ATI",
                typecode: "AT75",
                track: 233
              },
              {
                icao24: "4601f6",
                callsign: "FIN8NP",
                registration: "OH-ATI",
                typecode: "AT75",
                track: 234
              }
            ]
          ]
        }
      }
    ]);
  });

  it("does not claim arbitrary trajectory JSON", async () => {
    expect(
      await acceptsFlightRadar24Json({
        ...file,
        getJson: async () => [{ latitude: 60, longitude: 25, timestamp: 1 }]
      } as never)
    ).toBe(false);
  });
});
