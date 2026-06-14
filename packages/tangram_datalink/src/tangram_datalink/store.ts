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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = Record<string, unknown>;

export interface AdjacentPayload<K extends string = string, D = JsonValue> {
  kind: K;
  data: D;
}

export interface UnitPayload<K extends string = string> {
  kind: K;
}

export type AirframesAddrType = "aircraft" | "ground_station" | "unknown";

export interface AirframesAddr {
  icao24: string;
  addr_type: AirframesAddrType;
}

export interface AirframesPayload {
  label?: string | null;
  text?: string | null;
  from_hex?: string | null;
  to_hex?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  track?: number | null;
  frequency?: number | null;
  id?: string | number | null;
  airframe_id?: string | number | null;
  flight_id?: string | number | null;
  tail?: string | null;
  link_direction?: string | null;
}

export interface SquitterPayload extends JsonObject {
  station?: string | null;
  airport?: string | null;
  provider?: string | null;
  link?: string | null;
  frequency_mhz?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface AirframesMessage {
  payload: AirframesPayload;
  src?: AirframesAddr | null;
  dst?: AirframesAddr | null;
  app?: AcarsAppPayload | null;
}

export interface AcarsMessage {
  label?: string | null;
  txt?: string | null;
  text?: string | null;
  app?: AcarsAppPayload | null;
  payload?: JsonValue;
}

export type AvlcPayload =
  | AdjacentPayload<"acars", AcarsMessage>
  | AdjacentPayload<"xid", JsonObject>
  | AdjacentPayload<"x25", JsonObject>
  | AdjacentPayload<"unknown", string>;

export interface AvlcFrame {
  src?: { icao24: string; addr_type: string };
  dst?: { icao24: string; addr_type: string };
  payload?: AvlcPayload | null;
}

export interface Arinc622Message extends JsonObject {
  atsu_address?: string;
  imi?: string;
  registration?: string;
  payload?: Arinc622Payload;
}

export type Arinc622Payload =
  | AdjacentPayload<"adsc", AdscPayload>
  | AdjacentPayload<"cpdlc", CpdlcPayload>
  | AdjacentPayload<string, JsonObject>;

export interface AdscPositionReport {
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  timestamp_seconds_past_hour?: number;
  nav_redundancy_ok?: boolean;
  position_accuracy_code?: number;
  tcas_ok?: boolean;
}

export interface AdscPredictedRoute {
  next_latitude: number;
  next_longitude: number;
  next_altitude_ft?: number;
  next_eta_seconds?: number;
  next_next_latitude?: number;
  next_next_longitude?: number;
  next_next_altitude_ft?: number;
}

export interface AdscReferenceData {
  heading_or_track_degrees?: number;
  heading_invalid?: boolean;
  speed?: number;
  vertical_speed_ft_per_min?: number;
}

export interface AdscMeteoData {
  wind_speed_kt?: number;
  wind_direction_true_degrees?: number;
  wind_direction_invalid?: boolean;
  temperature_c?: number;
}

export interface AdscFlightId {
  id?: string;
}

export interface AdscAcknowledgement {
  contract_number?: number;
}

export interface AdscNegativeAcknowledgement {
  contract_request_number?: number;
  reason?: string;
}

export interface AdscCancelContract {
  contract_number?: number;
}

export type AdscContractGroup =
  | AdjacentPayload<"report_interval", { interval_secs?: number }>
  | AdjacentPayload<"flight_id", { modulus?: number }>
  | AdjacentPayload<"predicted_route", { modulus?: number }>
  | AdjacentPayload<"earth_reference_data", { modulus?: number }>
  | AdjacentPayload<"air_reference_data", { modulus?: number }>
  | AdjacentPayload<"meteo_data", { modulus?: number }>
  | AdjacentPayload<"airframe_id", { modulus?: number }>
  | AdjacentPayload<"lateral_deviation_change", { threshold_nm?: number }>
  | AdjacentPayload<"vertical_speed_change", { threshold_ft_per_min?: number }>
  | AdjacentPayload<"altitude_range", { ceiling_ft?: number; floor_ft?: number }>
  | UnitPayload<"report_waypoint_changes">
  | AdjacentPayload<
      "aircraft_intent_data",
      { modulus?: number; projection_time_mins?: number }
    >
  | AdjacentPayload<string, JsonObject>;

export interface AdscContractRequest {
  contract_number?: number;
  groups?: AdscContractGroup[];
}

export type AdscTag =
  | AdjacentPayload<"acknowledgement", AdscAcknowledgement>
  | AdjacentPayload<"negative_acknowledgement", AdscNegativeAcknowledgement>
  | AdjacentPayload<"noncompliance_notification", JsonObject>
  | UnitPayload<"cancel_emergency_mode">
  | AdjacentPayload<"basic_report", AdscPositionReport>
  | AdjacentPayload<"emergency_basic_report", AdscPositionReport>
  | AdjacentPayload<"lateral_deviation_change_event", AdscPositionReport>
  | AdjacentPayload<"flight_id", AdscFlightId>
  | AdjacentPayload<"predicted_route", AdscPredictedRoute>
  | AdjacentPayload<"earth_reference_data", AdscReferenceData>
  | AdjacentPayload<"air_reference_data", AdscReferenceData>
  | AdjacentPayload<"meteo_data", AdscMeteoData>
  | AdjacentPayload<"airframe_id", JsonObject>
  | AdjacentPayload<"vertical_rate_change_event", AdscPositionReport>
  | AdjacentPayload<"altitude_range_event", AdscPositionReport>
  | AdjacentPayload<"waypoint_change_event", AdscPositionReport>
  | AdjacentPayload<"intermediate_projection", JsonObject>
  | AdjacentPayload<"fixed_projection", JsonObject>
  | UnitPayload<"cancel_all_contracts">
  | AdjacentPayload<"cancel_contract", AdscCancelContract>
  | AdjacentPayload<"periodic_contract_request", AdscContractRequest>
  | AdjacentPayload<"event_contract_request", AdscContractRequest>
  | AdjacentPayload<"emergency_periodic_contract_request", AdscContractRequest>
  | AdjacentPayload<string, JsonObject>;

export interface AdscPayload extends JsonObject {
  tags?: AdscTag[];
}

export interface CpdlcPayload extends JsonObject {
  downlink?: CpdlcSide | null;
  uplink?: CpdlcSide | null;
  control?: AdjacentPayload<string, { message?: CpdlcSide | null }> | null;
}

export interface CpdlcSide extends JsonObject {
  header?: DatalinkCpdlcMessage["header"];
  elements?: DatalinkCpdlcElement[];
}

export type AcarsAppPayload =
  | UnitPayload<"none" | "link_test">
  | AdjacentPayload<"arinc622", Arinc622Message>
  | AdjacentPayload<"squitter", SquitterPayload>
  | AdjacentPayload<"text", string>
  | AdjacentPayload<
      | "miam"
      | "ohma"
      | "media_advisory"
      | "aoc_report"
      | "weather"
      | "label_5z"
      | "aoc_position"
      | "label_32"
      | "label_16"
      | "label_37"
      | "oooi_off_destination"
      | "oooi_off_report"
      | "atis_request"
      | "atis_delivery"
      | "afn"
      | "oceanic_clearance",
      JsonValue
    >;

export type DatalinkProtocolMessage =
  | AdjacentPayload<"airframes", AirframesMessage>
  | AdjacentPayload<"avlc", AvlcFrame>
  | AdjacentPayload<"acars", AcarsMessage>
  | AdjacentPayload<"hfdl", JsonObject>
  | AdjacentPayload<"app", AcarsAppPayload>;

export interface DatalinkMessage {
  event?: string | null;
  timestamp?: number | null;
  bearer?: string | null;
  source?: {
    id?: string | null;
    name?: string | null;
    class?: string | null;
    format?: string | null;
  } | null;
  receiver?: {
    bearer?: string | null;
    channel_hz?: number | null;
  } | null;
  aircraft?: {
    icao24?: string | null;
    registration?: string | null;
    aircraft_id?: string | number | null;
  };
  flight_id?: string | number | null;
  kinematics?: DatalinkKinematics;
  raw_frame_hex?: string;
  message: DatalinkProtocolMessage;
}

export interface AdscContractGroupInfo {
  kind: string;
  interval_secs?: number;
  modulus?: number;
  threshold_nm?: number;
  threshold_fpm?: number;
  ceiling_ft?: number;
  floor_ft?: number;
  projection_time_mins?: number;
}

export interface AdscContractInfo {
  kind: "periodic" | "event" | "emergency" | "cancel_all" | "cancel";
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
  next?: {
    latitude: number;
    longitude: number;
    altitude_ft?: number;
    eta_secs?: number;
  };
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

export type CpdlcElementBody = AdjacentPayload<string, JsonValue>;
export type CpdlcPhraseFragment =
  | AdjacentPayload<"text", string>
  | AdjacentPayload<"value", string>;

export interface DatalinkCpdlcElement {
  id: number;
  catalog_name?: string;
  fragments: CpdlcPhraseFragment[];
  body?: CpdlcElementBody | null;
  is_additional: boolean;
}

export interface CpdlcTimestamp {
  hour?: number;
  minute?: number;
  second?: number;
}

export interface DatalinkCpdlcMessage {
  timestamp?: number;
  atsu_address?: string;
  registration?: string;
  imi?: string;
  direction?: "downlink" | "uplink";
  header?: { msg_id?: number; msg_ref?: number; timestamp?: CpdlcTimestamp };
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

export const MESSAGE_CATEGORIES = [
  {
    id: "adsc",
    label: "ADS-C",
    description: "Automatic Dependent Surveillance Contract position and route reports"
  },
  {
    id: "cpdlc",
    label: "CPDLC",
    description: "Controller-Pilot Data Link Communications"
  },
  {
    id: "afn",
    label: "AFN",
    description:
      "ATN/FANS logon and addressing: Aeronautical Telecommunication Network / Future Air Navigation System"
  },
  {
    id: "text",
    label: "Free Text",
    description: "Free-text ACARS messages"
  },
  {
    id: "miam",
    label: "MIAM",
    description: "Media Independent Aircraft Messaging"
  },
  {
    id: "position",
    label: "Position",
    description: "AOC position & service advisory reports"
  },
  {
    id: "aoc",
    label: "AOC",
    description: "Airline Operational Control"
  },
  {
    id: "oooi",
    label: "OOOI",
    description: "Out/Off/On/In operational reports"
  },
  {
    id: "xid",
    label: "VDL2 XID",
    description: "VHF Data Link Mode 2 exchange identification link management frames"
  },
  { id: "other", label: "Other" }
] as const;

export type MessageCategoryId = (typeof MESSAGE_CATEGORIES)[number]["id"];

function defaultCategories(): Record<MessageCategoryId, boolean> {
  const out = {} as Record<MessageCategoryId, boolean>;
  for (const c of MESSAGE_CATEGORIES) out[c.id] = true;
  return out;
}

export const STATION_CATEGORIES = [
  { id: "sq", label: "SQ", description: "VHF squitter ground stations" },
  {
    id: "vdl2",
    label: "VDL2",
    description: "VHF Data Link Mode 2 GSIF ground stations"
  }
] as const;

export type StationCategoryId = (typeof STATION_CATEGORIES)[number]["id"];

function defaultStationCategories(): Record<StationCategoryId, boolean> {
  return { sq: true, vdl2: true };
}

export interface DatalinkFilter {
  /** Per-station-type visibility; all true is the unfiltered default. */
  stations: Record<StationCategoryId, boolean>;
  /** Per-aircraft category visibility; all true is the unfiltered default. */
  categories: Record<MessageCategoryId, boolean>;
}

function makeDefaultFilter(): DatalinkFilter {
  return {
    stations: defaultStationCategories(),
    categories: defaultCategories()
  };
}

export interface DatalinkSelectionData {
  trajectory: DatalinkEntity[];
  loading: boolean;
  error: string | null;
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
    datalinkStore.history.set(id, {
      adsc: [],
      cpdlc: [],
      messages: [],
      categories: new Set()
    });
  }
  return datalinkStore.history.get(id)!;
}

function ringPrepend<T>(arr: T[], item: T, limit: number) {
  arr.unshift(item);
  if (arr.length > limit) arr.length = limit;
}

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asObject = (value: unknown): JsonObject | null =>
  isObject(value) ? value : null;

export const messageData = (msg: DatalinkMessage): JsonObject | null =>
  asObject(msg.message.data);

const avlcAcarsMessage = (msg: DatalinkMessage): AcarsMessage | undefined => {
  if (msg.message.kind !== "avlc") return undefined;
  return msg.message.data.payload?.kind === "acars"
    ? msg.message.data.payload.data
    : undefined;
};

export const messageLabel = (msg: DatalinkMessage): string | undefined => {
  switch (msg.message.kind) {
    case "airframes":
      return msg.message.data.payload.label ?? undefined;
    case "acars":
      return msg.message.data.label ?? undefined;
    case "avlc":
      return avlcAcarsMessage(msg)?.label ?? undefined;
    case "app":
    case "hfdl":
      return undefined;
  }
};

export const messageApp = (
  msg: DatalinkMessage
): AcarsAppPayload | null | undefined => {
  switch (msg.message.kind) {
    case "app":
      return msg.message.data;
    case "acars":
    case "airframes":
      return msg.message.data.app;
    case "avlc":
      return avlcAcarsMessage(msg)?.app;
    case "hfdl":
      return undefined;
  }
};

export const getSquitterPayload = (msg: DatalinkMessage): SquitterPayload | null => {
  const app = messageApp(msg);
  return app?.kind === "squitter" ? app.data : null;
};

export const arinc622Payload = (
  app: AcarsAppPayload | null | undefined
): Arinc622Message | null => (app?.kind === "arinc622" ? app.data : null);

const stringField = (obj: JsonObject, key: string): string | undefined => {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
};

const numberField = (obj: JsonObject, key: string): number | undefined => {
  const value = obj[key];
  return typeof value === "number" ? value : undefined;
};

const arrayField = (obj: JsonObject, key: string): unknown[] => {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
};

export function classifyCategory(msg: DatalinkMessage): MessageCategoryId {
  const app = messageApp(msg);
  if (!app || app.kind === "none") return "other";

  if (getSquitterPayload(msg)) return "other";

  const avlcPayload = msg.message.kind === "avlc" ? msg.message.data.payload : null;
  if (avlcPayload?.kind === "xid" || avlcPayload?.kind === "x25") return "xid";

  const arinc = arinc622Payload(app);
  if (arinc) {
    const imi = arinc.imi ?? "";
    if (imi === "ADS") return "adsc";
    if (["AT1", "CR1", "CC1", "DR1"].includes(imi)) return "cpdlc";
    if (imi === "AFN" || imi === "ATS") return "afn";
    return "other";
  }

  if (app.kind === "afn") return "afn";
  if (app.kind === "text") return "text";
  if (app.kind === "miam") return "miam";
  if (app.kind === "media_advisory" || app.kind === "aoc_position") return "position";
  if (app.kind === "oooi_off_destination" || app.kind === "oooi_off_report")
    return "oooi";
  if (
    ["aoc_report", "oceanic_clearance", "atis_delivery", "atis_request"].includes(
      app.kind
    )
  )
    return "aoc";

  const label = messageLabel(msg);
  if (label) {
    if (["SA", "S1"].includes(label)) return "position";
    if (["QF", "QQ", "Q0"].includes(label)) return "oooi";
    if (label === "H1") return "cpdlc";
  }

  return "other";
}

const objectField = (obj: JsonObject, key: string): JsonObject | null => {
  const value = obj[key];
  return isObject(value) ? value : null;
};

const cpdlcTimestamp = (value: unknown): CpdlcTimestamp | undefined => {
  const timestamp = asObject(value);
  if (!timestamp) return undefined;
  return {
    hour: numberField(timestamp, "hour"),
    minute: numberField(timestamp, "minute"),
    second: numberField(timestamp, "second")
  };
};

const cpdlcHeader = (value: unknown): DatalinkCpdlcMessage["header"] => {
  const header = asObject(value);
  if (!header) return undefined;
  return {
    msg_id: numberField(header, "msg_id"),
    msg_ref: numberField(header, "msg_ref"),
    timestamp: cpdlcTimestamp(header.timestamp)
  };
};

const cpdlcElement = (value: unknown): DatalinkCpdlcElement | null => {
  const element = asObject(value);
  if (!element) return null;
  const id = numberField(element, "id");
  if (id == null) return null;
  const fragments = arrayField(element, "fragments")
    .map(fragment => {
      const value = asObject(fragment);
      if (!value) return null;
      const kind = stringField(value, "kind");
      const data = value.data;
      if (kind === "text" && typeof data === "string") return { kind, data };
      if (kind === "value" && typeof data === "string") return { kind, data };
      return null;
    })
    .filter(isPresent);
  const body = asObject(element.body) as CpdlcElementBody | null;
  return {
    id,
    catalog_name: stringField(element, "catalog_name"),
    fragments,
    body,
    is_additional: element.is_additional === true
  };
};

const isPresent = <T>(value: T | null | undefined): value is T => value != null;

export function classifyAndStore(id: string, msg: DatalinkMessage) {
  const hist = ensureHistory(id);
  ringPrepend(hist.messages, msg, HISTORY_LIMIT);

  hist.categories.add(classifyCategory(msg));
  datalinkStore.version++;

  const arinc = arinc622Payload(messageApp(msg));
  if (!arinc) return;

  const imi = arinc.imi ?? "";
  const payload = arinc.payload;

  if (imi === "ADS" && payload?.kind === "adsc") {
    const tags = payload.data.tags ?? [];
    const report: DatalinkAdscReport = {
      timestamp: msg.timestamp ?? undefined,
      registration: arinc.registration,
      atsu_address: arinc.atsu_address,
      raw_tags: tags.map(tag => tag.kind)
    };

    for (const tag of tags) {
      switch (tag.kind) {
        case "basic_report":
        case "emergency_basic_report":
        case "waypoint_change_event":
        case "lateral_deviation_change_event":
        case "vertical_rate_change_event":
        case "altitude_range_event": {
          report.position = {
            latitude: tag.data.latitude,
            longitude: tag.data.longitude
          };
          report.altitude_ft = tag.data.altitude_ft;
          break;
        }
        case "flight_id":
          report.flight_id = tag.data.id;
          break;
        case "predicted_route":
          report.next = {
            latitude: tag.data.next_latitude,
            longitude: tag.data.next_longitude,
            altitude_ft: tag.data.next_altitude_ft,
            eta_secs: tag.data.next_eta_seconds
          };
          if (
            tag.data.next_next_latitude != null &&
            tag.data.next_next_longitude != null
          ) {
            report.next_next = {
              latitude: tag.data.next_next_latitude,
              longitude: tag.data.next_next_longitude,
              altitude_ft: tag.data.next_next_altitude_ft
            };
          }
          break;
        case "earth_reference_data":
          if (tag.data.heading_invalid !== true) {
            report.track = tag.data.heading_or_track_degrees;
          }
          report.ground_speed_kt = tag.data.speed;
          report.vertical_speed_fpm = tag.data.vertical_speed_ft_per_min;
          break;
        case "air_reference_data":
          if (report.track == null && tag.data.heading_invalid !== true) {
            report.track = tag.data.heading_or_track_degrees;
          }
          break;
        case "intermediate_projection": {
          const distance_nm = numberField(tag.data, "distance_nm");
          const track_degrees = numberField(tag.data, "track_degrees");
          if (distance_nm != null && track_degrees != null) {
            report.intermediate_projections ??= [];
            report.intermediate_projections.push({
              distance_nm,
              track_degrees,
              track_invalid: tag.data.track_invalid === true,
              altitude_ft: numberField(tag.data, "altitude_ft"),
              eta_secs: numberField(tag.data, "eta_seconds")
            });
          }
          break;
        }
        case "fixed_projection": {
          const latitude = numberField(tag.data, "latitude");
          const longitude = numberField(tag.data, "longitude");
          if (latitude != null && longitude != null) {
            report.fixed_projections ??= [];
            report.fixed_projections.push({
              latitude,
              longitude,
              altitude_ft: numberField(tag.data, "altitude_ft"),
              eta_secs: numberField(tag.data, "eta_seconds")
            });
          }
          break;
        }
        case "meteo_data":
          report.wind_speed_kt = tag.data.wind_speed_kt;
          if (tag.data.wind_direction_invalid !== true) {
            report.wind_direction_deg = tag.data.wind_direction_true_degrees;
          }
          report.temperature_c = tag.data.temperature_c;
          break;
        case "periodic_contract_request":
        case "event_contract_request":
        case "emergency_periodic_contract_request":
          report.is_uplink = true;
          report.contract = {
            kind:
              tag.kind === "periodic_contract_request"
                ? "periodic"
                : tag.kind === "event_contract_request"
                  ? "event"
                  : "emergency",
            number: tag.data.contract_number,
            groups: (tag.data.groups ?? []).map(group => {
              const value = "data" in group ? group.data : {};
              return {
                kind: group.kind,
                interval_secs: numberField(value, "interval_secs"),
                modulus: numberField(value, "modulus"),
                threshold_nm: numberField(value, "threshold_nm"),
                threshold_fpm: numberField(value, "threshold_ft_per_min"),
                ceiling_ft: numberField(value, "ceiling_ft"),
                floor_ft: numberField(value, "floor_ft"),
                projection_time_mins: numberField(value, "projection_time_mins")
              };
            })
          };
          break;
        case "cancel_all_contracts":
          report.is_uplink = true;
          report.contract = { kind: "cancel_all", groups: [] };
          break;
        case "cancel_contract":
          report.is_uplink = true;
          report.contract = {
            kind: "cancel",
            number: tag.data.contract_number,
            groups: []
          };
          break;
      }
    }

    if (report.track == null && report.intermediate_projections) {
      const first = report.intermediate_projections.find(ip => !ip.track_invalid);
      if (first) report.track = first.track_degrees;
    }

    ringPrepend(hist.adsc, report, ADSC_LIMIT);
    return;
  }

  if (["AT1", "CR1", "CC1", "DR1"].includes(imi) && payload?.kind === "cpdlc") {
    const decodedPayload = payload.data;
    const cpdlcMsg: DatalinkCpdlcMessage = {
      timestamp: msg.timestamp ?? undefined,
      atsu_address: arinc.atsu_address,
      registration: arinc.registration,
      imi,
      elements: []
    };

    const control = objectField(decodedPayload, "control");
    if (control) cpdlcMsg.control_type = stringField(control, "kind");

    const downlink = objectField(decodedPayload, "downlink");
    const uplink = objectField(decodedPayload, "uplink");
    const controlData = control ? objectField(control, "data") : null;
    const controlSide = controlData ? objectField(controlData, "message") : null;
    const side = downlink ?? uplink ?? controlSide;

    if (side) {
      cpdlcMsg.direction = downlink ? "downlink" : "uplink";
      cpdlcMsg.header = cpdlcHeader(side.header);
      cpdlcMsg.elements = arrayField(side, "elements")
        .map(cpdlcElement)
        .filter(isPresent);
    } else if (control && !cpdlcMsg.elements.length) {
      cpdlcMsg.direction = "uplink";
    }

    ringPrepend(hist.cpdlc, cpdlcMsg, CPDLC_LIMIT);
  }
}
