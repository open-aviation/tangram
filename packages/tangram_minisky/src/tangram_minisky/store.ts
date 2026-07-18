import { reactive } from "vue";

export interface MiniskyAircraft {
  id: string;
  callsign: string;
  typecode?: string;
  latitude?: number;
  longitude?: number;
  /** feet */
  altitude?: number;
  /** knots */
  groundspeed?: number;
  /** knots */
  tas?: number;
  /** knots */
  ias?: number;
  /** feet per minute */
  vertical_rate?: number;
  /** degrees */
  track?: number;
  /** aircraft currently in a detected conflict */
  inconf: boolean;
}

export interface SimInfo {
  simt: number;
  simdt: number;
  simutc?: string;
  speed: number;
  ntraf: number;
  state: number;
  state_name: string;
  scenname?: string;
  nconf_cur: number;
  nlos_cur: number;
}

export const miniskyStore = reactive({
  siminfo: null as SimInfo | null,
  connected: false,
  lastUpdate: 0
});
