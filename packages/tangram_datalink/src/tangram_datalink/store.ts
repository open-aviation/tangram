import { reactive } from "vue";
import type { DatalinkAircraft } from "./index";

export interface DatalinkKinematics {
  position?: {
    latitude: number;
    longitude: number;
  };
  altitude_ft?: number;
  track?: number;
  ground_speed_knots?: number;
  derived_from?: string;
}

export interface DatalinkMessage {
  event: string;
  timestamp?: number;
  bearer: string;
  source: {
    id: string;
    name: string;
    class: string;
    format?: string;
  };
  receiver?: {
    bearer: string;
    channel_hz?: number;
  };
  aircraft?: {
    icao24?: string | null;
    registration?: string | null;
    aircraft_id?: string | number | null;
  };
  flight_id?: string | number | null;
  kinematics?: DatalinkKinematics;
  raw_frame_hex?: string;
  // dynamic payload fields
  label?: string;
  txt?: string;
  text?: string;
  app?: unknown;
  payload?: unknown;
  imi?: string;
  [key: string]: any;
}

export interface DatalinkSelectionData {
  trajectory: DatalinkAircraft[];
  loading: boolean;
  error: string | null;
  messages: DatalinkMessage[];
}

export const datalinkStore = reactive({
  selected: new Map<string, DatalinkSelectionData>(),
  selectedIds: new Set<string>(),
  version: 0
});
