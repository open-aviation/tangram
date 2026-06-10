import { reactive } from "vue";
import type { DatalinkEntity } from "./index";

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
  label?: string;
  txt?: string;
  text?: string;
  app?: unknown;
  payload?: unknown;
  imi?: string;
  [key: string]: any;
}

export interface AdscContractGroupInfo {
  type: string;
  interval_secs?: number;
  modulus?: number;
  threshold_nm?: number;
  threshold_fpm?: number;
  ceiling_ft?: number;
  floor_ft?: number;
  projection_time_mins?: number;
}

export interface AdscContractInfo {
  kind: 'periodic' | 'event' | 'emergency' | 'cancel_all' | 'cancel';
  number?: number;
  groups: AdscContractGroupInfo[];
}

export interface AdscIntermediateProjection {
  distance_nm: number;
  track_degrees: number;
  track_invalid: boolean;
  altitude_ft?: number;
  eta_secs?: number;
}

export interface AdscFixedProjection {
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  eta_secs?: number;
}

export interface DatalinkAdscReport {
  timestamp?: number;
  registration?: string;
  position?: { latitude: number; longitude: number };
  altitude_ft?: number;
  /** resolved track: EarthReferenceData (valid) → IntermediateProjection[0] → null */
  track?: number;
  ground_speed_kt?: number;
  vertical_speed_fpm?: number;
  /** FlightId tag content */
  flight_id?: string;
  /** ATSU address (ground station) */
  atsu_address?: string;
  /** PredictedRoute next waypoint (absolute lat/lon) */
  next?: { latitude: number; longitude: number; altitude_ft?: number; eta_secs?: number };
  /** PredictedRoute next+1 waypoint (absolute lat/lon) */
  next_next?: { latitude: number; longitude: number; altitude_ft?: number };
  /** IntermediateProjection entries (relative: distance + bearing from current position) */
  intermediate_projections?: AdscIntermediateProjection[];
  /** FixedProjection entries (absolute lat/lon) */
  fixed_projections?: AdscFixedProjection[];
  wind_speed_kt?: number;
  wind_direction_deg?: number;
  temperature_c?: number;
  /** true when this is an uplink (ground→aircraft) contract request */
  is_uplink?: boolean;
  /** structured contract info for uplink messages */
  contract?: AdscContractInfo;
  raw_tags: string[];
}

export interface DatalinkCpdlcElement {
  id: number;
  name: string;
  template?: string | null;
  body?: unknown;
  is_additional: boolean;
}

export interface DatalinkCpdlcMessage {
  timestamp?: number;
  atsu_address?: string;
  registration?: string;
  imi?: string;
  direction?: string;
  header?: { msg_id?: number; msg_ref?: number; timestamp?: string };
  elements: DatalinkCpdlcElement[];
  control_type?: string;
}

export interface DatalinkEntityHistory {
  adsc: DatalinkAdscReport[];
  cpdlc: DatalinkCpdlcMessage[];
  /** all raw messages for the general feed tab */
  messages: DatalinkMessage[];
  /** set of category ids seen for this entity */
  categories: Set<MessageCategoryId>;
}

const HISTORY_LIMIT = 200;
const ADSC_LIMIT = 50;
const CPDLC_LIMIT = 100;

// ── Message categories ─────────────────────────────────────────────────────────

export const MESSAGE_CATEGORIES = [
  { id: "adsc",     label: "ADS-C",      description: "ADS Contract position & route reports" },
  { id: "cpdlc",    label: "CPDLC",     description: "Controller-Pilot Data Link Communications" },
  { id: "afn",      label: "AFN",       description: "ATN/FANS logon & addressing" },
  { id: "text",     label: "Free Text",  description: "Free-text ACARS messages" },
  { id: "miam",     label: "MIAM",      description: "Media Independent Aircraft Messaging" },
  { id: "position", label: "Position",  description: "AOC position & service advisory reports" },
  { id: "aoc",      label: "AOC",       description: "Airline Operational Control" },
  { id: "oooi",     label: "OOOI",      description: "Out/Off/On/In operational reports" },
  { id: "xid",      label: "VDL2 XID",  description: "VDL2 link management frames" },
  { id: "other",    label: "Other",     description: "Other decoded frames" },
] as const;

export type MessageCategoryId = (typeof MESSAGE_CATEGORIES)[number]["id"];

function defaultCategories(): Record<MessageCategoryId, boolean> {
  const out = {} as Record<MessageCategoryId, boolean>;
  for (const c of MESSAGE_CATEGORIES) out[c.id] = true;
  return out;
}

export const STATION_CATEGORIES = [
  { id: "sq",   label: "SQ stations",   description: "VHF squitter ground stations" },
  { id: "vdl2", label: "VDL2 stations", description: "VDL2 GSIF ground stations" },
] as const;

export type StationCategoryId = (typeof STATION_CATEGORIES)[number]["id"];

function defaultStationCategories(): Record<StationCategoryId, boolean> {
  return { sq: true, vdl2: true };
}

export interface DatalinkFilter {
  /** when false, all entities are visible regardless of the categories below */
  enabled: boolean;
  /** per-station-type visibility */
  stations: Record<StationCategoryId, boolean>;
  /** one toggle per message category; aircraft shown if ≥1 checked category matches */
  categories: Record<MessageCategoryId, boolean>;
}

function makeDefaultFilter(): DatalinkFilter {
  return { enabled: false, stations: defaultStationCategories(), categories: defaultCategories() };
}

export interface DatalinkSelectionData {
  trajectory: DatalinkEntity[];
  loading: boolean;
  error: string | null;
  /** legacy: kept for compatibility, mirrors history.messages */
  messages: DatalinkMessage[];
}

export const datalinkStore = reactive({
  selected: new Map<string, DatalinkSelectionData>(),
  selectedIds: new Set<string>(),
  /** universal per-entity message history, keyed by entity id, populated regardless of selection */
  history: new Map<string, DatalinkEntityHistory>(),
  filter: makeDefaultFilter() as DatalinkFilter,
  version: 0
});

export function ensureHistory(id: string): DatalinkEntityHistory {
  if (!datalinkStore.history.has(id)) {
    datalinkStore.history.set(id, { adsc: [], cpdlc: [], messages: [], categories: new Set() });
  }
  return datalinkStore.history.get(id)!;
}

function ringPrepend<T>(arr: T[], item: T, limit: number) {
  arr.unshift(item);
  if (arr.length > limit) arr.length = limit;
}

export function classifyCategory(msg: DatalinkMessage): MessageCategoryId {
  const app = msg.app as any;
  if (!app || app === "None") return "other";

  // Squitter / station frames — treated as "other" for aircraft history
  if (app.SQ || app.Squitter || app.station) return "other";

  // VDL2 XID management frames
  const payload = (msg as any).payload;
  if (payload?.Xid || payload?.X25) return "xid";

  if (typeof app === "object") {
    // Arinc622 envelope — discriminate by IMI
    const arinc = app.Arinc622;
    if (arinc) {
      const imi: string = arinc.imi ?? "";
      if (imi === "ADS") return "adsc";
      if (["AT1", "CR1", "CC1", "DR1"].includes(imi)) return "cpdlc";
      if (imi === "AFN" || imi === "ATS") return "afn";
      return "other";
    }

    if (app.AFN) return "afn";
    if (app.Text) return "text";
    if (app.MIAM) return "miam";
    // Service Advisory / position reports
    if (app.SA || app.AocPosition) return "position";
    // OOOI
    if (app.QF || app.QQ) return "oooi";
    // AOC labels
    if (app.AOC80 || app.OC1 || app.A9 || app.B9 || app.A0) return "aoc";
  }

  // Fallback: use label-based heuristics
  const label = msg.label;
  if (label) {
    if (["SA", "S1"].includes(label)) return "position";
    if (["QF", "QQ", "Q0"].includes(label)) return "oooi";
    if (["H1"].includes(label)) return "cpdlc"; // H1 = FANS/ACARS CPDLC
  }

  return "other";
}

export function classifyAndStore(id: string, msg: DatalinkMessage) {
  const hist = ensureHistory(id);
  ringPrepend(hist.messages, msg, HISTORY_LIMIT);

  // track category for filter
  hist.categories.add(classifyCategory(msg));
  // bump version so the layer re-renders when a new category is acquired
  datalinkStore.version++;

  const app = msg.app as any;
  if (!app || app === "None") return;

  const arinc = app?.Arinc622;
  if (arinc) {
    const imi = arinc.imi;
    const payload = arinc.payload;

    if (imi === "ADS") {
      const tags: any[] = payload?.data?.tags ?? [];
      const report: DatalinkAdscReport = {
        timestamp: msg.timestamp,
        registration: arinc.registration,
        atsu_address: arinc.atsu_address,
        raw_tags: tags.map((t: any) => Object.keys(t)[0]).filter(Boolean)
      };

      for (const tag of tags) {
        if (tag.BasicReport || tag.EmergencyBasicReport) {
          const b = tag.BasicReport ?? tag.EmergencyBasicReport;
          report.position = { latitude: b.latitude, longitude: b.longitude };
          report.altitude_ft = b.altitude_ft;
        }
        if (tag.WaypointChangeEvent || tag.LateralDeviationChangeEvent ||
            tag.VerticalRateChangeEvent || tag.AltitudeRangeEvent) {
          const b = tag.WaypointChangeEvent ?? tag.LateralDeviationChangeEvent ??
                    tag.VerticalRateChangeEvent ?? tag.AltitudeRangeEvent;
          report.position = { latitude: b.latitude, longitude: b.longitude };
          report.altitude_ft = b.altitude_ft;
        }
        if (tag.FlightId) {
          report.flight_id = tag.FlightId.id;
        }
        if (tag.PredictedRoute) {
          const p = tag.PredictedRoute;
          report.next = {
            latitude: p.next_latitude,
            longitude: p.next_longitude,
            altitude_ft: p.next_altitude_ft,
            eta_secs: p.next_eta_seconds
          };
          if (p.next_next_latitude != null) {
            report.next_next = {
              latitude: p.next_next_latitude,
              longitude: p.next_next_longitude,
              altitude_ft: p.next_next_altitude_ft
            };
          }
        }
        if (tag.EarthReferenceData) {
          const e = tag.EarthReferenceData;
          if (!e.heading_invalid) report.track = e.heading_or_track_degrees;
          report.ground_speed_kt = e.speed;
          report.vertical_speed_fpm = e.vertical_speed_ft_per_min;
        }
        if (tag.AirReferenceData && report.track == null) {
          const a = tag.AirReferenceData;
          if (!a.heading_invalid) report.track = a.heading_or_track_degrees;
        }
        if (tag.IntermediateProjection) {
          const ip = tag.IntermediateProjection;
          if (!report.intermediate_projections) report.intermediate_projections = [];
          report.intermediate_projections.push({
            distance_nm: ip.distance_nm,
            track_degrees: ip.track_degrees,
            track_invalid: ip.track_invalid,
            altitude_ft: ip.altitude_ft,
            eta_secs: ip.eta_seconds
          });
        }
        if (tag.FixedProjection) {
          const fp = tag.FixedProjection;
          if (!report.fixed_projections) report.fixed_projections = [];
          report.fixed_projections.push({
            latitude: fp.latitude,
            longitude: fp.longitude,
            altitude_ft: fp.altitude_ft,
            eta_secs: fp.eta_seconds
          });
        }
        if (tag.MeteoData) {
          const m = tag.MeteoData;
          report.wind_speed_kt = m.wind_speed_kt;
          if (!m.wind_direction_invalid) report.wind_direction_deg = m.wind_direction_true_degrees;
          report.temperature_c = m.temperature_c;
        }
        // ── Uplink contract tags ──
        const contractTag =
          tag.PeriodicContractRequest ?   { kind: 'periodic' as const,   req: tag.PeriodicContractRequest } :
          tag.EventContractRequest ?      { kind: 'event' as const,      req: tag.EventContractRequest } :
          tag.EmergencyPeriodicContractRequest ? { kind: 'emergency' as const, req: tag.EmergencyPeriodicContractRequest } :
          null;
        if (contractTag) {
          report.is_uplink = true;
          report.contract = {
            kind: contractTag.kind,
            number: contractTag.req.contract_number,
            groups: (contractTag.req.groups ?? []).map((g: any) => ({
              type: g.type,
              interval_secs: g.value?.interval_secs,
              modulus: g.value?.modulus,
              threshold_nm: g.value?.threshold_nm,
              threshold_fpm: g.value?.threshold_ft_per_min,
              ceiling_ft: g.value?.ceiling_ft,
              floor_ft: g.value?.floor_ft,
              projection_time_mins: g.value?.projection_time_mins
            }))
          };
        }
        if (tag.CancelAllContracts != null) {
          report.is_uplink = true;
          report.contract = { kind: 'cancel_all', groups: [] };
        }
        if (tag.CancelContract != null) {
          report.is_uplink = true;
          report.contract = { kind: 'cancel', number: tag.CancelContract.contract_number ?? tag.CancelContract, groups: [] };
        }
      }

      // Fallback track: IntermediateProjection track when EarthReferenceData heading was invalid
      if (report.track == null && report.intermediate_projections) {
        const first = report.intermediate_projections.find(ip => !ip.track_invalid);
        if (first) report.track = first.track_degrees;
      }

      ringPrepend(hist.adsc, report, ADSC_LIMIT);
      return;
    }

    if (["AT1", "CR1", "CC1", "DR1"].includes(imi)) {
      const cpdlcMsg: DatalinkCpdlcMessage = {
        timestamp: msg.timestamp,
        atsu_address: arinc.atsu_address,
        registration: arinc.registration,
        imi,
        elements: []
      };
      const cpdlc = payload?.Cpdlc ?? payload?.data;
      if (cpdlc) {
        // control messages (CR1/CC1/DR1)
        if (cpdlc.control) {
          cpdlcMsg.control_type = cpdlc.control.type;
        }
        const side = cpdlc.downlink ?? cpdlc.uplink ?? cpdlc.control?.message?.downlink ?? cpdlc.control?.message?.uplink;
        if (side) {
          cpdlcMsg.direction = cpdlc.downlink ? "downlink" : "uplink";
          cpdlcMsg.header = side.header;
          cpdlcMsg.elements = (side.elements ?? []).map((e: any) => ({
            id: e.id,
            name: e.name ?? "?",
            template: e.template ?? null,
            body: e.body ?? null,
            is_additional: e.is_additional ?? false
          }));
        } else if (cpdlc.control && !cpdlcMsg.elements.length) {
          // bare control (e.g. disconnect_request) — no elements
          cpdlcMsg.direction = "downlink";
        }
      }
      ringPrepend(hist.cpdlc, cpdlcMsg, CPDLC_LIMIT);
      return;
    }
  }
}
