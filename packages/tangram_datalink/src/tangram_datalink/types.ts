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

export type AirframesAddrType = "aircraft" | "ground_station" | "unknown";

export interface AirframesAddr {
  icao24: string;
  addr_type: AirframesAddrType;
}

export interface AirframesPayload {
  label: string | null;
  text: string | null;
  from_hex: string | null;
  to_hex: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  track: number | null;
  source_type: DatalinkBearer;
  timestamp: number | null;
  created_at: number | null;
  frequency: number | null;
  id: string | null;
  airframe_id: number | null;
  flight_id: number | null;
  tail: string | null;
  link_direction: string | null;
  airframe: { icao: string | null; tail: string | null } | null;
  flight: {
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    track: number | null;
  } | null;
}

export interface SquitterPayload {
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

export type AcarsBlockId = { DL: number } | { UL: string };
export type AcarsDirection = "Unknown" | "UL" | "DL";

export interface AcarsMessage {
  mode: string;
  tail: string;
  ack: string;
  label: string;
  block_id: AcarsBlockId;
  msg_nb?: string;
  sequence?: string;
  flight_id?: string;
  sublabel?: string;
  text: string;
  direction: AcarsDirection;
  block_end: boolean;
  app: AcarsAppPayload;
}

export type AvlcPayload =
  | { acars: AcarsMessage }
  | { xid: JsonObject }
  | { x25: JsonObject }
  | { unknown: string };

export type AvlcSFunc =
  "ReceiveReady" | "ReceiveNotReady" | "Reject" | "SelectiveReject";

export type AvlcLcf =
  | { I: { send_seq: number; poll: boolean; recv_seq: number } }
  | { S: { sfunc: AvlcSFunc; pf: boolean; recv_seq: number } }
  | { U: { name: string; mfunc: number; pf: boolean } };

export type AvlcAddrType = "aircraft" | "ground_station" | "all_stations";
export type AvlcFrameRole = "Command" | "Response";
export type AvlcAircraftGroundStatus = "Airborne" | "OnGround";

export interface AvlcFrame {
  src: { icao24: string; addr_type: AvlcAddrType };
  dst: { icao24: string; addr_type: AvlcAddrType };
  role: AvlcFrameRole;
  ag_status?: AvlcAircraftGroundStatus;
  lcf: AvlcLcf;
  payload?: AvlcPayload;
}

export interface Arinc622Message {
  atsu_address: string;
  imi: string;
  registration: string;
  payload: Arinc622Payload;
}

export type AdscDisconnectReason =
  | "reason_not_specified"
  | "congestion"
  | "application_not_available"
  | "normal_disconnect"
  | "unknown";

export type Arinc622Payload =
  | { adsc: AdscPayload }
  | { adsc_disconnect: AdscDisconnectReason }
  | { cpdlc: CpdlcPayload }
  | { aoc: { payload_hex: string } }
  | { unknown: { payload_hex: string } };

export interface AdscPositionReport {
  latitude: number;
  longitude: number;
  altitude_ft: number;
  timestamp_seconds_past_hour: number;
  nav_redundancy_ok: boolean;
  position_accuracy_code: number;
  tcas_ok: boolean;
}

export interface AdscPredictedRoute {
  next_latitude: number;
  next_longitude: number;
  next_altitude_ft: number;
  next_eta_seconds: number;
  next_next_latitude: number;
  next_next_longitude: number;
  next_next_altitude_ft: number;
}

export interface AdscEarthReferenceData {
  true_track_degrees?: number;
  track_invalid?: boolean;
  ground_speed_kt: number;
  vertical_speed_ft_per_min: number;
}

export interface AdscAirReferenceData {
  true_heading_degrees?: number;
  heading_invalid?: boolean;
  mach: number;
  vertical_speed_ft_per_min: number;
}

export interface AdscMeteoData {
  wind_speed_kt: number;
  wind_direction_true_degrees?: number;
  wind_direction_invalid?: boolean;
  temperature_c: number;
}

export interface AdscFlightId {
  callsign: string;
}

export interface AdscAirframeId {
  /** Lowercase six-digit hexadecimal ICAO address. */
  icao24: string;
}

export interface AdscAcknowledgement {
  contract_number: number;
}

export type AdscNackReason =
  | "duplicate_group_tag"
  | "duplicate_reporting_interval_tag"
  | "event_contract_request_with_no_data"
  | "improper_operational_mode_tag"
  | "cancel_request_of_nonexistent_contract"
  | "requested_contract_already_exists"
  | "undefined_contract_request_tag"
  | "undefined_error"
  | "not_enough_data_in_request"
  | "invalid_altitude_range"
  | "vertical_speed_threshold_is_zero"
  | "aircraft_intent_projection_time_is_zero"
  | "lateral_deviation_threshold_is_zero"
  | { unknown: { code: number } };

export interface AdscNegativeAcknowledgement {
  contract_request_number: number;
  reason: AdscNackReason;
  extension: number | null;
}

export type AdscNoncompliantTag =
  | "lateral_deviation_change"
  | "report_interval"
  | "flight_id"
  | "predicted_route"
  | "earth_reference_data"
  | "air_reference_data"
  | "meteo_data"
  | "airframe_id"
  | "vertical_speed_change"
  | "altitude_range"
  | "report_waypoint_changes"
  | "aircraft_intent_data"
  | { unknown: { tag: number } };

export interface AdscNoncomplianceGroup {
  noncompliant_tag: AdscNoncompliantTag;
  is_unrecognized: boolean;
  is_whole_group_unavailable: boolean;
  parameters: number[];
}

export interface AdscNoncomplianceNotification {
  contract_request_number: number;
  groups: AdscNoncomplianceGroup[];
}

export interface AdscCancelContract {
  contract_number: number;
}

export interface AdscIntermediateProjectionPayload {
  distance_nm: number;
  track_degrees?: number;
  track_invalid?: boolean;
  altitude_ft: number;
  eta_seconds: number;
}

export interface AdscFixedProjectionPayload {
  latitude: number;
  longitude: number;
  altitude_ft: number;
  eta_seconds: number;
}

export type AdscPeriodicReportGroup =
  | { flight_id: { modulus: number } }
  | { predicted_route: { modulus: number } }
  | { earth_reference_data: { modulus: number } }
  | { air_reference_data: { modulus: number } }
  | { meteo_data: { modulus: number } }
  | { airframe_id: { modulus: number } }
  | { aircraft_intent_data: { modulus: number; projection_time_mins: number } };

export type AdscEventTrigger =
  | { lateral_deviation_change: { threshold_nm: number } }
  | { vertical_speed_change: { threshold_ft_per_min: number } }
  | { altitude_range: { ceiling_ft: number; floor_ft: number } }
  | "waypoint_change";

export type AdscContractGroup = AdscPeriodicReportGroup | AdscEventTrigger;

export interface AdscPeriodicContractRequest {
  contract_number: number;
  report_interval_secs: number;
  requested_groups: AdscPeriodicReportGroup[];
}

export interface AdscEventContractRequest {
  contract_number: number;
  events: AdscEventTrigger[];
}

export type AdscTag =
  | { acknowledgement: AdscAcknowledgement }
  | { negative_acknowledgement: AdscNegativeAcknowledgement }
  | { noncompliance_notification: AdscNoncomplianceNotification }
  | "cancel_emergency_mode"
  | { basic_report: AdscPositionReport }
  | { emergency_basic_report: AdscPositionReport }
  | { lateral_deviation_change_event: AdscPositionReport }
  | { flight_id: AdscFlightId }
  | { predicted_route: AdscPredictedRoute }
  | { earth_reference_data: AdscEarthReferenceData }
  | { air_reference_data: AdscAirReferenceData }
  | { meteo_data: AdscMeteoData }
  | { airframe_id: AdscAirframeId }
  | { vertical_rate_change_event: AdscPositionReport }
  | { altitude_range_event: AdscPositionReport }
  | { waypoint_change_event: AdscPositionReport }
  | { intermediate_projection: AdscIntermediateProjectionPayload }
  | { fixed_projection: AdscFixedProjectionPayload }
  | "cancel_all_contracts"
  | { cancel_contract: AdscCancelContract }
  | { periodic_contract_request: AdscPeriodicContractRequest }
  | { event_contract_request: AdscEventContractRequest }
  | { emergency_periodic_contract_request: AdscPeriodicContractRequest };

export type AdscPayload = AdscTag[];

export type CpdlcControlMessage =
  | { connect_request: { message?: CpdlcSide | null } }
  | { connect_confirm: { message?: CpdlcSide | null } }
  | "disconnect_request";

export interface CpdlcPayload {
  payload_hex: string;
  payload_len_bytes: number;
  downlink?: CpdlcSide | null;
  uplink?: CpdlcSide | null;
  control?: CpdlcControlMessage | null;
}

export interface CpdlcSide {
  header: CpdlcHeader;
  elements: CpdlcElement[];
  remaining_bits_after_element: number;
}

export type AcarsAppPayload =
  | "none"
  | "link_test"
  | { arinc622: Arinc622Message }
  | { squitter: SquitterPayload }
  | { text: string }
  | { miam: MiamPayload }
  | { ohma: OhmaPayload }
  | { media_advisory: MediaAdvisoryPayload }
  | { aoc_report: AocReportPayload }
  | { weather: WeatherPayload }
  | { label_5z: Label5zPayload }
  | { aoc_position: AocPositionPayload }
  | { label_32: Label32Payload }
  | { label_16: Label16Payload }
  | { label_37: Label37Payload }
  | { oooi_off_destination: OooiOffDestinationPayload }
  | { oooi_off_report: OooiOffReportPayload }
  | { atis_request: AtisRequestPayload }
  | { atis_delivery: AtisDeliveryPayload }
  | { afn: AfnPayload }
  | { oceanic_clearance: OceanicClearancePayload };

export type DatalinkProtocolMessage =
  | { airframes: AirframesMessage }
  | { avlc: AvlcFrame }
  | { acars: AcarsMessage }
  | { hfdl: JsonObject }
  | { app: AcarsAppPayload };

export type DatalinkBearer = "vhf" | "vdl2" | "hfdl" | "decoded" | "unknown";
export type DatalinkSourceClass = "iq" | "events" | "frames";

export interface DatalinkMessage {
  event: string;
  timestamp?: number;
  bearer: DatalinkBearer;
  source: {
    id: string;
    name: string;
    class: DatalinkSourceClass;
    format?: string;
  };
  receiver?: {
    bearer: DatalinkBearer;
    channel_hz?: number;
  };
  aircraft?: {
    icao24?: string;
    registration?: string;
    aircraft_id?: number;
  };
  kinematics?: DatalinkKinematics;
  raw_frame_hex?: string;
  message: DatalinkProtocolMessage;
}

export interface AdscIntermediateProjection {
  distance_nm: number;
  track_degrees?: number;
  track_invalid: boolean;
  altitude_ft?: number;
  eta_seconds_past_hour?: number;
}

export interface AdscFixedProjection {
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  eta_seconds_past_hour?: number;
}

export interface DatalinkAdscReport {
  timestamp?: number;
  /** Timestamp from the position report, encoded as seconds past the hour. */
  report_seconds_past_hour?: number;
  registration?: string;
  /** Lowercase six-digit hexadecimal ICAO address from AirframeId. */
  icao24?: string;
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
    eta_seconds_past_hour?: number;
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
}

export type CpdlcElementBody = Record<string, JsonValue> | "unsupported";
export type CpdlcPhraseFragment = { text: string } | { value: string };

export interface CpdlcElement {
  id: number;
  catalog_name: string;
  fragments: CpdlcPhraseFragment[];
  body?: CpdlcElementBody | null;
  is_additional: boolean;
}

export interface CpdlcTimestamp {
  hour: number;
  minute: number;
  second: number;
}

export interface CpdlcHeader {
  msg_id: number;
  msg_ref?: number;
  timestamp?: CpdlcTimestamp;
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
  | { Data: { header: LoosePayloadObject; body?: LoosePayloadObject | null } }
  | { Ack: LoosePayloadObject }
  | { Unknown: { pdu_type: number; version: number } };

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
