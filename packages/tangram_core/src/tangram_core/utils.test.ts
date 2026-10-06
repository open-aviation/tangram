import { describe, expect, it } from "vitest";
import { finiteNumber, isJsonlFile, parseJsonlRows } from "./utils";

describe("finiteNumber", () => {
  it.each([
    null,
    undefined,
    "",
    "  ",
    false,
    true,
    [],
    [0],
    {},
    NaN,
    Infinity,
    -Infinity,
    "invalid"
  ])("rejects missing or nonnumeric input %j", value => {
    expect(finiteNumber(value)).toBeNull();
  });

  it.each([
    [0, 0],
    ["0", 0],
    [48.8625, 48.8625],
    [" 2.2948 ", 2.2948],
    [-12.5, -12.5]
  ])("preserves numeric input %j", (value, expected) => {
    expect(finiteNumber(value)).toBe(expected);
  });
});

const compressedJsonl = Uint8Array.from(
  Buffer.from(
    "KLUv/QRY7QEAFAN7ImljYW8yNCI6ImFiYzEyMyIsImxhdGl0dWRlIjo0OC44LCJsb25nMi4zfQo5NH0KAwCgE1cNDXJnGWBUVoE=",
    "base64"
  )
);

describe("JSONL imports", () => {
  it("recognizes and decompresses .jsonl.zst files", async () => {
    const file = {
      metadata: {
        name: "history.jsonl.zst",
        extension: ".zst",
        mediaType: "application/zstd"
      },
      rawFile: {} as File,
      getBytes: async () => compressedJsonl,
      getText: async () => {
        throw new Error("compressed files must be read as bytes");
      }
    };

    expect(isJsonlFile(file)).toBe(true);
    await expect(parseJsonlRows(file)).resolves.toEqual([
      { icao24: "abc123", latitude: 48.8, longitude: 2.3 },
      { icao24: "abc123", latitude: 48.9, longitude: 2.4 }
    ]);
  });
});
