import { reactive } from "vue";
import type { DatalinkAircraft } from "./index";

export interface DatalinkKinematics {
  latitude?: number;
  longitude?: number;
  altitude_ft?: number;
  track?: number;
  derived_from?: string;
}

export interface DatalinkMessage {
  timestamp: number;
  source_system: string;
  bearer: string;
  station_id?: string | null;
  channel_mhz?: number | null;
  direction?: string | null;
  icao24?: string | null;
  registration?: string | null;
  flight_id?: string | null;
  label?: string | null;
  sublabel?: string | null;
  imi?: string | null;
  text?: string | null;
  app_protocol?: string | null;
  app_data: unknown;
  kinematics?: DatalinkKinematics | null;
  raw_frame_hex?: string | null;
  error?: string | null;
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
