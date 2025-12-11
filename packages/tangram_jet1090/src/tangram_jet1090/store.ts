import { reactive } from "vue";
import type { Jet1090Aircraft } from ".";

export interface AirportInfo {
  lat: number | null;
  lon: number | null;
  name: string;
  city: string;
  icao: string;
}

export interface AircraftSelectionData {
  trajectory: Jet1090Aircraft[];
  loading: boolean;
  error: string | null;
  route: {
    origin: AirportInfo | null;
    destination: AirportInfo | null;
  };
}

export const aircraftStore = reactive({
  selected: new Map<string, AircraftSelectionData>(),
  version: 0
});

export const pluginConfig = reactive({
  showRouteLines: true
});
