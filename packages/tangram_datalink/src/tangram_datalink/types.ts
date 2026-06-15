export type LoosePayloadObject = Record<string, unknown>;

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

export interface AdscProjection {
  latitude?: number;
  longitude?: number;
  altitude_ft?: number;
  eta_seconds?: number;
  distance_nm?: number;
  track_degrees?: number;
  track_invalid?: boolean;
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
  | AdjacentPayload<"intermediate_projection", AdscProjection>
  | AdjacentPayload<"fixed_projection", AdscProjection>
  | UnitPayload<"cancel_all_contracts">
  | AdjacentPayload<"cancel_contract", AdscCancelContract>
  | AdjacentPayload<"periodic_contract_request", AdscContractRequest>
  | AdjacentPayload<"event_contract_request", AdscContractRequest>
  | AdjacentPayload<"emergency_periodic_contract_request", AdscContractRequest>
  | AdjacentPayload<"unknown", JsonObject>;

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
  | AdjacentPayload<"miam", MiamPayload>
  | AdjacentPayload<"ohma", OhmaPayload>
  | AdjacentPayload<"media_advisory", MediaAdvisoryPayload>
  | AdjacentPayload<"aoc_report", AocReportPayload>
  | AdjacentPayload<"weather", WeatherPayload>
  | AdjacentPayload<"label_5z", Label5zPayload>
  | AdjacentPayload<"aoc_position", AocPositionPayload>
  | AdjacentPayload<"label_32", Label32Payload>
  | AdjacentPayload<"label_16", Label16Payload>
  | AdjacentPayload<"label_37", Label37Payload>
  | AdjacentPayload<"oooi_off_destination", OooiOffDestinationPayload>
  | AdjacentPayload<"oooi_off_report", OooiOffReportPayload>
  | AdjacentPayload<"atis_request", AtisRequestPayload>
  | AdjacentPayload<"atis_delivery", AtisDeliveryPayload>
  | AdjacentPayload<"afn", AfnPayload>
  | AdjacentPayload<"oceanic_clearance", OceanicClearancePayload>;

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

export interface AfnApplication {
  code: string;
  value: string;
}

export interface AfnPayload {
  facility: string;
  message_type: string;
  flight_id?: string;
  registration?: string;
  icao24?: string;
  timestamp?: string;
  applications?: AfnApplication[];
  raw: string;
}

export interface OceanicClearancePayload {
  facility: string;
  protocol: string;
  clearance_type: string;
  clearance_number?: string;
  flight_id?: string;
  entry_point?: string;
  entry_time?: string;
  mach?: string;
  flight_level?: string;
  remarks?: string;
  raw: string;
}

export interface AtisRequestPayload {
  airport: string;
  current_atis: string;
  offset: number;
  crc: string;
}

export interface AtisDeliveryPayload {
  airport: string;
  kind?: string;
  atis_letter?: string;
  issued_time?: string;
  text: string;
  crc?: string;
}

export interface WeatherReportPayload {
  station: string;
  day?: string;
  time?: string;
  text: string;
}

export interface WeatherPayload {
  header?: string;
  reports?: WeatherReportPayload[];
  raw: string;
}

export interface SlashFieldPayload {
  key: string;
  value: string;
}

export interface Label5zPayload {
  fields: SlashFieldPayload[];
  remarks?: string;
  raw: string;
}

export interface PositionLikePayload {
  latitude?: number;
  longitude?: number;
  altitude_ft?: number;
  heading_deg?: number;
  timestamp?: string;
  departure?: string;
  destination?: string;
}

export interface AocPositionPayload extends PositionLikePayload {
  format: string;
  raw: string;
}

export interface Label32Payload extends PositionLikePayload {
  fields: string[];
  raw: string;
}

export interface Label16Payload {
  timestamp?: string;
  fields: string[];
  raw: string;
}

export interface Label37Payload {
  prefix?: string;
  line_count: number;
  raw: string;
}

export type LinkState = "Established" | "Lost";
export type LinkType =
  | "VhfAcars"
  | "Satcom"
  | "Hf"
  | "GlobalStar"
  | "IcoSatcom"
  | "Vdl2"
  | "Inmarsat"
  | "Iridium";

export interface MediaAdvisoryPayload {
  version: number;
  state: LinkState;
  current_link: LinkType;
  time_utc: string;
  available_links: LinkType[];
  text?: string;
}

export interface OooiOffDestinationPayload {
  departure: string;
  time_utc: string;
  destination: string;
  extras?: string;
}

export interface OooiOffReportPayload {
  departure: string;
  arrival: string;
  time_utc: string;
  extras?: string;
}

export interface AocReportPayload {
  msg_type: string;
  msg_type_description: string;
  leading_value?: string;
  flight_number?: string;
  date?: string;
  departure?: string;
  destination?: string;
  registration?: string;
  eta?: string;
  ert?: string;
  flight_level?: number;
  vertical_trend?: string;
  vertical_rate?: string;
  remarks?: string;
}

export type MiamCorePdu =
  | { kind: "data"; data: LoosePayloadObject }
  | { kind: "ack"; data: LoosePayloadObject }
  | { kind: "unknown"; data: LoosePayloadObject }
  | LoosePayloadObject;

export interface MiamPayload extends LoosePayloadObject {
  frame_id: string;
  body_pad: number;
  header_pad: number;
  core: MiamCorePdu;
}

export interface OhmaFlight extends LoosePayloadObject {
  events?: LoosePayloadObject[];
}

export interface OhmaAirplane extends LoosePayloadObject {
  tail_number: string;
  flights?: OhmaFlight[];
}

export interface OhmaPayload extends LoosePayloadObject {
  version: string;
  client_id: string;
  message_date: string;
  airplanes: OhmaAirplane[];
  convo_id?: string;
  msg_seq?: number;
  msg_total?: number;
}

export interface SummaryPhrasePart {
  kind: "text" | "value";
  text: string;
}

export interface SummaryRow {
  meta: string;
  detail?: string;
  parts?: SummaryPhrasePart[];
}

export interface PhraseSummaryRow extends SummaryRow {
  parts: SummaryPhrasePart[];
}
