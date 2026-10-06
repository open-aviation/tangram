import { describe, expect, it } from "vitest";
import { LazyImportFile } from "@open-aviation/tangram-core/api";
import {
  parseShip162Jsonl,
  type Ship162ImportedPayload
} from "../../tangram_ship162/src/tangram_ship162/imported_trajectory";

function jsonlFile(rows: Record<string, unknown>[]): LazyImportFile {
  const text = rows.map(row => JSON.stringify(row)).join("\n");
  return new LazyImportFile(
    new File([text], "ships.jsonl", { type: "application/json" })
  );
}

describe("ship162 JSONL imports", () => {
  it("drops unavailable positions instead of inserting points at zero", async () => {
    const file = jsonlFile([
      { mmsi: 226009910, timestamp: 100, latitude: 48.8625, longitude: 2.2948 },
      { mmsi: 226009910, timestamp: 110, latitude: null, longitude: null },
      { mmsi: 226009910, timestamp: 120, latitude: null, longitude: 2.295 },
      { mmsi: 226009910, timestamp: 130, latitude: 48.863, longitude: null },
      { mmsi: 226009910, timestamp: 140 },
      { mmsi: 226009910, timestamp: 150, latitude: 48.863, longitude: 2.295 }
    ]);
    const [dataset] = await parseShip162Jsonl(file);
    const payload = dataset.payload as Ship162ImportedPayload;
    expect(payload.recordCount).toBe(2);
    expect(payload.tracks).toHaveLength(1);
    expect(payload.tracks[0].map(point => [point.longitude, point.latitude])).toEqual([
      [2.2948, 48.8625],
      [2.295, 48.863]
    ]);
  });

  it("preserves genuine zero coordinates", async () => {
    const [dataset] = await parseShip162Jsonl(
      jsonlFile([{ mmsi: 226009910, timestamp: 100, latitude: 0, longitude: 0 }])
    );
    const payload = dataset.payload as Ship162ImportedPayload;
    expect(payload.tracks[0][0]).toMatchObject({ latitude: 0, longitude: 0 });
  });

  it("rejects files containing only unavailable positions", async () => {
    await expect(
      parseShip162Jsonl(
        jsonlFile([
          { mmsi: 226007260, timestamp: 100, latitude: null, longitude: null }
        ])
      )
    ).rejects.toThrow("No valid ship history");
  });
});
