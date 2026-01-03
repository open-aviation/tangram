import { reactive } from "vue";

export interface FlightInfo {
  icao24: string;
  callsign: string;
  start_ts: string;
  end_ts: string;
  duration: number;
  n_rows: number;
  lat: number;
  lon: number;
}

export const flightStore = reactive({
  selectedFlight: null as FlightInfo | null,
  version: 0 // to force layer updates
});
