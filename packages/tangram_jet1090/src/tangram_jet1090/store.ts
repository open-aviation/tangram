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

export interface TrailColorOptions {
  by_attribute: "altitude" | "groundspeed" | "vertical_rate" | "track";
  min?: number;
  max?: number;
}

export interface HistoryInterval {
  icao24: string;
  callsign: string;
  start_ts: string;
  end_ts: string;
  duration: number;
  n_rows: number;
  lat: number;
  lon: number;
}

export const aircraftStore = reactive({
  selected: new Map<string, AircraftSelectionData>(),
  version: 0,
  selectedHistoryInterval: null as HistoryInterval | null,
  historyVersion: 0
});

export const pluginConfig = reactive({
  showRouteLines: true,
  trailType: "line" as "line" | "curtain",
  trailColor: "#600000" as string | TrailColorOptions,
  trailAlpha: 0.6,
  enable3d: true
});
