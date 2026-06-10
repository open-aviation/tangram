import { airport_information } from "rs1090-wasm";

interface AirportSearchEntry {
  name: string;
  city?: string;
  countryCode?: string;
  iata?: string;
  icao: string;
}

const airportNameCache = new Map<string, string>();

export function airportName(code: string | null | undefined) {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return undefined;
  if (airportNameCache.has(normalized)) return airportNameCache.get(normalized);

  try {
    const airports = airport_information(normalized) as AirportSearchEntry[];
    const exact = airports.find(airport => airport.icao === normalized);
    const airport = exact || airports[0];
    const name = airport?.name || normalized;
    airportNameCache.set(normalized, name);
    return name;
  } catch {
    airportNameCache.set(normalized, normalized);
    return normalized;
  }
}
