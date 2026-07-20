interface AirportSearchEntry {
  name: string;
  city?: string;
  countryCode?: string;
  iata?: string;
  icao: string;
}

export type AirportName = (code: string | null | undefined) => string | undefined;

export function createAirportName(
  rs1090: typeof import("rs1090-wasm/web")
): AirportName {
  const cache = new Map<string, string>();

  return code => {
    if (!code) return undefined;
    const normalized = code.trim().toUpperCase();
    if (!normalized) return undefined;
    if (cache.has(normalized)) return cache.get(normalized);

    const airports = rs1090.airport_information(normalized) as AirportSearchEntry[];
    const exact = airports.find(airport => airport.icao === normalized);
    const name = (exact || airports[0])?.name || normalized;

    // rs1090's airport dataset is immutable for the lifetime of this plugin instance
    cache.set(normalized, name);
    return name;
  };
}
