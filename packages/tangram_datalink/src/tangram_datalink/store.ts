import { shallowReactive } from "vue";
import type { DatalinkEntity } from "./index";
import type {
  AcarsAppPayload,
  AcarsMessage,
  AdscPositionReport,
  Arinc622Message,
  Arinc622Payload,
  DatalinkAdscReport,
  DatalinkMessage,
  DatalinkProtocolMessage,
  SquitterPayload
} from "./types";

export interface DatalinkEntityHistory {
  adsc: DatalinkAdscReport[];
  /** all raw messages for the general feed tab */
  messages: DatalinkMessage[];
  /** set of category ids seen for this entity */
  categories: Set<MessageCategoryId>;
}

const HISTORY_LIMIT = 200;
const ADSC_LIMIT = 50;

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
  return {
    adsc: true,
    cpdlc: true,
    afn: true,
    text: true,
    miam: true,
    position: true,
    aoc: true,
    oooi: true,
    xid: true,
    other: true
  };
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

export interface DatalinkStore {
  selected: Map<string, DatalinkSelectionData>;
  selectedIds: Set<string>;
  history: Map<string, DatalinkEntityHistory>;
  filter: DatalinkFilter;
  version: number;
}

export const datalinkStore: DatalinkStore = shallowReactive({
  selected: new Map<string, DatalinkSelectionData>(),
  selectedIds: new Set<string>(),
  /** universal per-entity message history, keyed by entity id, populated regardless of selection */
  history: new Map<string, DatalinkEntityHistory>(),
  filter: makeDefaultFilter(),
  version: 0
});

export function ensureHistory(id: string): DatalinkEntityHistory {
  if (!datalinkStore.history.has(id)) {
    datalinkStore.history.set(id, {
      adsc: [],
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

export const messageKind = (message: DatalinkProtocolMessage): string => {
  if ("airframes" in message) return "airframes";
  if ("avlc" in message) return "avlc";
  if ("acars" in message) return "acars";
  if ("hfdl" in message) return "hfdl";
  return "app";
};

export const arinc622PayloadKind = (payload: Arinc622Payload): string => {
  if ("adsc" in payload) return "adsc";
  if ("adsc_disconnect" in payload) return "adsc_disconnect";
  if ("cpdlc" in payload) return "cpdlc";
  if ("aoc" in payload) return "aoc";
  return "unknown";
};

export const avlcAcarsMessage = (msg: DatalinkMessage): AcarsMessage | undefined => {
  if (!("avlc" in msg.message)) return undefined;
  const payload = msg.message.avlc.payload;
  return payload && "acars" in payload ? payload.acars : undefined;
};

export const messageLabel = (msg: DatalinkMessage): string | undefined => {
  if ("airframes" in msg.message)
    return msg.message.airframes.payload.label ?? undefined;
  if ("acars" in msg.message) return msg.message.acars.label ?? undefined;
  if ("avlc" in msg.message) return avlcAcarsMessage(msg)?.label ?? undefined;
  return undefined;
};

export const messageFlightId = (msg: DatalinkMessage): string | number | undefined => {
  if ("airframes" in msg.message)
    return msg.message.airframes.payload.flight_id ?? undefined;
  if ("acars" in msg.message) return msg.message.acars.flight_id;
  if ("avlc" in msg.message) return avlcAcarsMessage(msg)?.flight_id;
  if ("app" in msg.message) {
    const app = msg.message.app;
    if (
      typeof app !== "string" &&
      "arinc622" in app &&
      "adsc" in app.arinc622.payload
    ) {
      for (const tag of app.arinc622.payload.adsc) {
        if (typeof tag !== "string" && "flight_id" in tag)
          return tag.flight_id.callsign;
      }
    }
  }
  return undefined;
};

export const messageApp = (
  msg: DatalinkMessage
): AcarsAppPayload | null | undefined => {
  if ("app" in msg.message) return msg.message.app;
  if ("acars" in msg.message) return msg.message.acars.app;
  if ("airframes" in msg.message) return msg.message.airframes.app;
  if ("avlc" in msg.message) return avlcAcarsMessage(msg)?.app;
  return undefined;
};

export const getSquitterPayload = (msg: DatalinkMessage): SquitterPayload | null => {
  const app = messageApp(msg);
  return app && typeof app !== "string" && "squitter" in app ? app.squitter : null;
};

export const arinc622Payload = (
  app: AcarsAppPayload | null | undefined
): Arinc622Message | null =>
  app && typeof app !== "string" && "arinc622" in app ? app.arinc622 : null;

export const adscDisconnectReason = (msg: DatalinkMessage): string | null => {
  const arinc = arinc622Payload(messageApp(msg));
  return arinc?.imi === "DIS" && "adsc_disconnect" in arinc.payload
    ? arinc.payload.adsc_disconnect
    : null;
};

export function classifyCategory(msg: DatalinkMessage): MessageCategoryId {
  if ("avlc" in msg.message) {
    const payload = msg.message.avlc.payload;
    if (payload && ("xid" in payload || "x25" in payload)) return "xid";
  }

  const app = messageApp(msg);
  if (!app || app === "none" || app === "link_test") return "other";
  if (typeof app === "string") return "other";
  if ("squitter" in app) return "other";

  if ("arinc622" in app) {
    const imi = app.arinc622.imi;
    if (imi === "ADS" || imi === "DIS") return "adsc";
    if (["AT1", "CR1", "CC1", "DR1"].includes(imi)) return "cpdlc";
    if (imi === "AFN" || imi === "ATS") return "afn";
    return "other";
  }

  if ("afn" in app) return "afn";
  if ("text" in app) return "text";
  if ("miam" in app || "ohma" in app) return "miam";
  if ("media_advisory" in app || "aoc_position" in app) return "position";
  if ("label_32" in app)
    return app.label_32.latitude != null && app.label_32.longitude != null
      ? "position"
      : "aoc";
  if ("oooi_off_destination" in app || "oooi_off_report" in app) return "oooi";
  if (
    "aoc_report" in app ||
    "oceanic_clearance" in app ||
    "atis_delivery" in app ||
    "atis_request" in app ||
    "weather" in app ||
    "label_5z" in app ||
    "label_16" in app ||
    "label_37" in app
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

const setPositionReport = (report: DatalinkAdscReport, value: AdscPositionReport) => {
  report.position = { latitude: value.latitude, longitude: value.longitude };
  report.altitude_ft = value.altitude_ft;
  report.report_seconds_past_hour = value.timestamp_seconds_past_hour;
};

const hasTrajectoryData = (report: DatalinkAdscReport): boolean =>
  report.position != null ||
  report.track != null ||
  report.next != null ||
  report.next_next != null ||
  Boolean(report.intermediate_projections?.length) ||
  Boolean(report.fixed_projections?.length);

export function classifyAndStore(id: string, msg: DatalinkMessage) {
  const hist = ensureHistory(id);
  ringPrepend(hist.messages, msg, HISTORY_LIMIT);
  hist.categories.add(classifyCategory(msg));
  datalinkStore.version++;

  const arinc = arinc622Payload(messageApp(msg));
  if (!arinc) return;

  if (arinc.imi === "ADS" && "adsc" in arinc.payload) {
    const tags = arinc.payload.adsc;
    const report: DatalinkAdscReport = {
      timestamp: msg.timestamp ?? undefined,
      registration: arinc.registration,
      atsu_address: arinc.atsu_address
    };

    for (const tag of tags) {
      if (typeof tag === "string") continue;
      if ("basic_report" in tag) {
        setPositionReport(report, tag.basic_report);
      } else if ("emergency_basic_report" in tag) {
        setPositionReport(report, tag.emergency_basic_report);
      } else if ("waypoint_change_event" in tag) {
        setPositionReport(report, tag.waypoint_change_event);
      } else if ("lateral_deviation_change_event" in tag) {
        setPositionReport(report, tag.lateral_deviation_change_event);
      } else if ("vertical_rate_change_event" in tag) {
        setPositionReport(report, tag.vertical_rate_change_event);
      } else if ("altitude_range_event" in tag) {
        setPositionReport(report, tag.altitude_range_event);
      } else if ("flight_id" in tag) {
        report.flight_id = tag.flight_id.callsign;
      } else if ("airframe_id" in tag) {
        report.icao24 = tag.airframe_id.icao24.toLowerCase();
      } else if ("predicted_route" in tag) {
        const route = tag.predicted_route;
        report.next = {
          latitude: route.next_latitude,
          longitude: route.next_longitude,
          altitude_ft: route.next_altitude_ft,
          eta_seconds_past_hour: route.next_eta_seconds
        };
        report.next_next = {
          latitude: route.next_next_latitude,
          longitude: route.next_next_longitude,
          altitude_ft: route.next_next_altitude_ft
        };
      } else if ("earth_reference_data" in tag) {
        const data = tag.earth_reference_data;
        if (!data.track_invalid) report.track = data.true_track_degrees;
        report.ground_speed_kt = data.ground_speed_kt;
        report.vertical_speed_fpm = data.vertical_speed_ft_per_min;
      } else if ("air_reference_data" in tag) {
        const data = tag.air_reference_data;
        if (report.track == null && !data.heading_invalid)
          report.track = data.true_heading_degrees;
      } else if ("intermediate_projection" in tag) {
        const data = tag.intermediate_projection;
        report.intermediate_projections ??= [];
        report.intermediate_projections.push({
          distance_nm: data.distance_nm,
          track_degrees: data.track_degrees,
          track_invalid: data.track_invalid === true || data.track_degrees == null,
          altitude_ft: data.altitude_ft,
          eta_seconds_past_hour: data.eta_seconds
        });
      } else if ("fixed_projection" in tag) {
        const data = tag.fixed_projection;
        report.fixed_projections ??= [];
        report.fixed_projections.push({
          latitude: data.latitude,
          longitude: data.longitude,
          altitude_ft: data.altitude_ft,
          eta_seconds_past_hour: data.eta_seconds
        });
      } else if ("meteo_data" in tag) {
        const data = tag.meteo_data;
        report.wind_speed_kt = data.wind_speed_kt;
        if (!data.wind_direction_invalid)
          report.wind_direction_deg = data.wind_direction_true_degrees;
        report.temperature_c = data.temperature_c;
      }
    }

    if (report.track == null && report.intermediate_projections) {
      const first = report.intermediate_projections.find(
        projection => !projection.track_invalid && projection.track_degrees != null
      );
      if (first) report.track = first.track_degrees;
    }
    if (hasTrajectoryData(report)) ringPrepend(hist.adsc, report, ADSC_LIMIT);
    return;
  }
}
