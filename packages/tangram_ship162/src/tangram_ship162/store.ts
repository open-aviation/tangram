import { reactive } from "vue";
import type { Ship162Vessel } from ".";

export interface TrailColorOptions {
  by_attribute: "speed";
  min?: number;
  max?: number;
}

export interface ShipSelectionData {
  trajectory: Ship162Vessel[];
  loading: boolean;
  error: string | null;
}

export interface HistoryInterval {
  mmsi: string;
  ship_name: string;
  start_ts: string;
  end_ts: string;
  duration: number;
  n_rows: number;
  lat: number;
  lon: number;
}

export const shipStore = reactive({
  selected: new Map<string, ShipSelectionData>(),
  version: 0,
  selectedHistoryInterval: null as HistoryInterval | null,
  historyVersion: 0
});

export const pluginConfig = reactive({
  trailColor: {
    by_attribute: "speed",
    min: 0,
    max: 14
  } as string | TrailColorOptions,
  trailAlpha: 0.6
});
