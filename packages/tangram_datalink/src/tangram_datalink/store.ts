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

export type ExternalPayload<K extends string, D = JsonValue> = { [P in K]: D };

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
  | ExternalPayload<"Acars", AcarsMessage>
  | ExternalPayload<"Xid", JsonObject>
  | ExternalPayload<"X25", JsonObject>;

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
  | AdjacentPayload<"Adsc", AdscPayload>
  | AdjacentPayload<"Cpdlc", CpdlcPayload>
  | AdjacentPayload<"Aoc" | "Unknown", { payload_hex?: string }>;

export interface AdscPayload extends JsonObject {
  tags?: AdscTag[];
}

export type AdscTag = JsonObject;

export interface CpdlcPayload extends JsonObject {
  downlink?: CpdlcSide | null;
  uplink?: CpdlcSide | null;
  control?: AdjacentPayload<string, { message?: CpdlcPayload | null }> | null;
}

export interface CpdlcSide extends JsonObject {
  header?: DatalinkCpdlcMessage["header"];
  elements?: DatalinkCpdlcElement[];
}

export type AcarsAppPayload =
  | "None"
  | ExternalPayload<"Arinc622", Arinc622Message>
  | ExternalPayload<"SQ", SquitterPayload>
  | ExternalPayload<"Squitter", SquitterPayload>
  | ExternalPayload<"AFN", JsonValue>
  | ExternalPayload<"Text", string>
  | ExternalPayload<"MIAM", JsonValue>
  | ExternalPayload<"SA", JsonValue>
  | ExternalPayload<"AocPosition", JsonValue>
  | ExternalPayload<"QF", JsonValue>
  | ExternalPayload<"QQ", JsonValue>
  | ExternalPayload<"AOC80", JsonValue>
  | ExternalPayload<"OC1", JsonValue>
  | ExternalPayload<"A9", JsonValue>
  | ExternalPayload<"B9", JsonValue>
  | ExternalPayload<"A0", JsonValue>;

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

export type CpdlcElementBody = JsonObject;

export interface DatalinkCpdlcElement {
  id: number;
  body?: CpdlcElementBody | null;
  is_additional: boolean;
}

export interface DatalinkCpdlcMessage {
  timestamp?: number;
  atsu_address?: string;
  registration?: string;
  imi?: string;
  direction?: "downlink" | "uplink";
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

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasExternalPayload = <K extends string>(
  value: unknown,
  variant: K
): value is ExternalPayload<K, unknown> => isObject(value) && hasOwn(value, variant);

const externalPayload = <T>(value: unknown, variant: string): T | undefined =>
  hasExternalPayload(value, variant) ? (value[variant] as T) : undefined;

const adjacentData = (value: unknown): JsonObject | null => {
  if (!isObject(value)) return null;
  return isObject(value.data) ? value.data : null;
};

const asObject = (value: unknown): JsonObject | null =>
  isObject(value) ? value : null;

export const messageData = (msg: DatalinkMessage): JsonObject | null =>
  asObject(msg.message.data);

const avlcAcarsMessage = (msg: DatalinkMessage): AcarsMessage | undefined => {
  if (msg.message.kind !== "avlc") return undefined;
  return externalPayload<AcarsMessage>(msg.message.data.payload, "Acars");
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
  return (
    externalPayload<SquitterPayload>(app, "Squitter") ??
    externalPayload<SquitterPayload>(app, "SQ") ??
    null
  );
};

const arinc622Payload = (
  app: AcarsAppPayload | null | undefined
): Arinc622Message | null => externalPayload<Arinc622Message>(app, "Arinc622") ?? null;

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
  if (!app || app === "None") return "other";

  if (getSquitterPayload(msg)) return "other";

  if (
    msg.message.kind === "avlc" &&
    (hasExternalPayload(msg.message.data.payload, "Xid") ||
      hasExternalPayload(msg.message.data.payload, "X25"))
  ) {
    return "xid";
  }

  const arinc = arinc622Payload(app);
  if (arinc) {
    const imi = stringField(arinc, "imi") ?? "";
    if (imi === "ADS") return "adsc";
    if (["AT1", "CR1", "CC1", "DR1"].includes(imi)) return "cpdlc";
    if (imi === "AFN" || imi === "ATS") return "afn";
    return "other";
  }

  if (hasExternalPayload(app, "AFN")) return "afn";
  if (hasExternalPayload(app, "Text")) return "text";
  if (hasExternalPayload(app, "MIAM")) return "miam";
  if (hasExternalPayload(app, "SA") || hasExternalPayload(app, "AocPosition"))
    return "position";
  if (hasExternalPayload(app, "QF") || hasExternalPayload(app, "QQ")) return "oooi";
  if (
    hasExternalPayload(app, "AOC80") ||
    hasExternalPayload(app, "OC1") ||
    hasExternalPayload(app, "A9") ||
    hasExternalPayload(app, "B9") ||
    hasExternalPayload(app, "A0")
  ) {
    return "aoc";
  }

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

const cpdlcHeader = (value: unknown): DatalinkCpdlcMessage["header"] => {
  const header = asObject(value);
  if (!header) return undefined;
  return {
    msg_id: numberField(header, "msg_id"),
    msg_ref: numberField(header, "msg_ref"),
    timestamp: stringField(header, "timestamp")
  };
};

const cpdlcElement = (value: unknown): DatalinkCpdlcElement | null => {
  const element = asObject(value);
  if (!element) return null;
  const id = numberField(element, "id");
  if (id == null) return null;
  return {
    id,
    body: asObject(element.body),
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

  const imi = stringField(arinc, "imi");
  const payload = objectField(arinc, "payload");
  const decodedPayload = payload ? adjacentData(payload) : null;

  if (imi === "ADS" && decodedPayload) {
    const tags = arrayField(decodedPayload, "tags").filter(isObject);
    const report: DatalinkAdscReport = {
      timestamp: msg.timestamp ?? undefined,
      registration: stringField(arinc, "registration"),
      atsu_address: stringField(arinc, "atsu_address"),
      raw_tags: tags.map(tag => Object.keys(tag)[0]).filter(Boolean)
    };

    for (const tag of tags) {
      const basic =
        objectField(tag, "BasicReport") ?? objectField(tag, "EmergencyBasicReport");
      if (basic) {
        const latitude = numberField(basic, "latitude");
        const longitude = numberField(basic, "longitude");
        if (latitude != null && longitude != null) {
          report.position = { latitude, longitude };
        }
        report.altitude_ft = numberField(basic, "altitude_ft");
      }

      const event =
        objectField(tag, "WaypointChangeEvent") ??
        objectField(tag, "LateralDeviationChangeEvent") ??
        objectField(tag, "VerticalRateChangeEvent") ??
        objectField(tag, "AltitudeRangeEvent");
      if (event) {
        const latitude = numberField(event, "latitude");
        const longitude = numberField(event, "longitude");
        if (latitude != null && longitude != null) {
          report.position = { latitude, longitude };
        }
        report.altitude_ft = numberField(event, "altitude_ft");
      }

      const flightId = objectField(tag, "FlightId");
      if (flightId) report.flight_id = stringField(flightId, "id");

      const predictedRoute = objectField(tag, "PredictedRoute");
      if (predictedRoute) {
        const latitude = numberField(predictedRoute, "next_latitude");
        const longitude = numberField(predictedRoute, "next_longitude");
        if (latitude != null && longitude != null) {
          report.next = {
            latitude,
            longitude,
            altitude_ft: numberField(predictedRoute, "next_altitude_ft"),
            eta_secs: numberField(predictedRoute, "next_eta_seconds")
          };
        }
        const nextLatitude = numberField(predictedRoute, "next_next_latitude");
        const nextLongitude = numberField(predictedRoute, "next_next_longitude");
        if (nextLatitude != null && nextLongitude != null) {
          report.next_next = {
            latitude: nextLatitude,
            longitude: nextLongitude,
            altitude_ft: numberField(predictedRoute, "next_next_altitude_ft")
          };
        }
      }

      const earthReference = objectField(tag, "EarthReferenceData");
      if (earthReference) {
        if (earthReference.heading_invalid !== true) {
          report.track = numberField(earthReference, "heading_or_track_degrees");
        }
        report.ground_speed_kt = numberField(earthReference, "speed");
        report.vertical_speed_fpm = numberField(
          earthReference,
          "vertical_speed_ft_per_min"
        );
      }

      const airReference = objectField(tag, "AirReferenceData");
      if (
        airReference &&
        report.track == null &&
        airReference.heading_invalid !== true
      ) {
        report.track = numberField(airReference, "heading_or_track_degrees");
      }

      const intermediateProjection = objectField(tag, "IntermediateProjection");
      if (intermediateProjection) {
        const distance_nm = numberField(intermediateProjection, "distance_nm");
        const track_degrees = numberField(intermediateProjection, "track_degrees");
        if (distance_nm != null && track_degrees != null) {
          report.intermediate_projections ??= [];
          report.intermediate_projections.push({
            distance_nm,
            track_degrees,
            track_invalid: intermediateProjection.track_invalid === true,
            altitude_ft: numberField(intermediateProjection, "altitude_ft"),
            eta_secs: numberField(intermediateProjection, "eta_seconds")
          });
        }
      }

      const fixedProjection = objectField(tag, "FixedProjection");
      if (fixedProjection) {
        const latitude = numberField(fixedProjection, "latitude");
        const longitude = numberField(fixedProjection, "longitude");
        if (latitude != null && longitude != null) {
          report.fixed_projections ??= [];
          report.fixed_projections.push({
            latitude,
            longitude,
            altitude_ft: numberField(fixedProjection, "altitude_ft"),
            eta_secs: numberField(fixedProjection, "eta_seconds")
          });
        }
      }

      const meteo = objectField(tag, "MeteoData");
      if (meteo) {
        report.wind_speed_kt = numberField(meteo, "wind_speed_kt");
        if (meteo.wind_direction_invalid !== true) {
          report.wind_direction_deg = numberField(meteo, "wind_direction_true_degrees");
        }
        report.temperature_c = numberField(meteo, "temperature_c");
      }

      const periodicContract = objectField(tag, "PeriodicContractRequest");
      const eventContract = objectField(tag, "EventContractRequest");
      const emergencyContract = objectField(tag, "EmergencyPeriodicContractRequest");
      const contractTag = periodicContract
        ? { kind: "periodic" as const, req: periodicContract }
        : eventContract
          ? { kind: "event" as const, req: eventContract }
          : emergencyContract
            ? { kind: "emergency" as const, req: emergencyContract }
            : null;

      if (contractTag) {
        report.is_uplink = true;
        report.contract = {
          kind: contractTag.kind,
          number: numberField(contractTag.req, "contract_number"),
          groups: arrayField(contractTag.req, "groups")
            .filter(isObject)
            .map(group => {
              const value = objectField(group, "value") ?? {};
              return {
                kind: stringField(group, "kind") ?? "unknown",
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
      }

      if (tag.CancelAllContracts != null) {
        report.is_uplink = true;
        report.contract = { kind: "cancel_all", groups: [] };
      }

      const cancelContract = asObject(tag.CancelContract);
      if (cancelContract || typeof tag.CancelContract === "number") {
        report.is_uplink = true;
        report.contract = {
          kind: "cancel",
          number: cancelContract
            ? numberField(cancelContract, "contract_number")
            : Number(tag.CancelContract),
          groups: []
        };
      }
    }

    if (report.track == null && report.intermediate_projections) {
      const first = report.intermediate_projections.find(ip => !ip.track_invalid);
      if (first) report.track = first.track_degrees;
    }

    ringPrepend(hist.adsc, report, ADSC_LIMIT);
    return;
  }

  if (["AT1", "CR1", "CC1", "DR1"].includes(imi ?? "") && decodedPayload) {
    const cpdlcMsg: DatalinkCpdlcMessage = {
      timestamp: msg.timestamp ?? undefined,
      atsu_address: stringField(arinc, "atsu_address"),
      registration: stringField(arinc, "registration"),
      imi,
      elements: []
    };

    const control = objectField(decodedPayload, "control");
    if (control) cpdlcMsg.control_type = stringField(control, "kind");

    const downlink = objectField(decodedPayload, "downlink");
    const uplink = objectField(decodedPayload, "uplink");
    const controlData = control ? objectField(control, "data") : null;
    const controlMessage = controlData ? objectField(controlData, "message") : null;
    const controlDownlink = controlMessage
      ? objectField(controlMessage, "downlink")
      : null;
    const controlUplink = controlMessage ? objectField(controlMessage, "uplink") : null;
    const side = downlink ?? uplink ?? controlDownlink ?? controlUplink;

    if (side) {
      cpdlcMsg.direction = downlink || controlDownlink ? "downlink" : "uplink";
      cpdlcMsg.header = cpdlcHeader(side.header);
      cpdlcMsg.elements = arrayField(side, "elements")
        .map(cpdlcElement)
        .filter(isPresent);
    } else if (control && !cpdlcMsg.elements.length) {
      cpdlcMsg.direction = "downlink";
    }

    ringPrepend(hist.cpdlc, cpdlcMsg, CPDLC_LIMIT);
  }
}
