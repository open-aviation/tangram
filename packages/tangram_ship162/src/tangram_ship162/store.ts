import { reactive } from "vue";
import type { Ship162Vessel } from ".";

export interface ShipSelectionData {
  trajectory: Ship162Vessel[];
  loading: boolean;
  error: string | null;
}

export const shipStore = reactive({
  selected: new Map<string, ShipSelectionData>(),
  version: 0
});
