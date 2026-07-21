<template>
  <SummaryRows :rows="rows" empty="ads-c" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  AdscAirReferenceData,
  AdscContractGroup,
  AdscEarthReferenceData,
  AdscMeteoData,
  AdscNackReason,
  AdscNoncomplianceNotification,
  AdscNoncompliantTag,
  AdscPositionReport,
  AdscPredictedRoute,
  AdscTag,
  DatalinkMessage
} from "../types";
import { arinc622Message } from "../summary_helpers";
import { adscDisconnectReason } from "../store";
import SummaryRows from "./Rows.vue";
import type { SummaryRow } from "../types";

defineOptions({ name: "DatalinkSummaryAdsc" });

const props = defineProps<{ msg: DatalinkMessage }>();

/**
 * See https://arxiv.org/abs/2505.06254 Fig. 3 / Table II:
 * BasicReport (~77%) and PredictedRoute (~75%) are
 * the dominant trajectory tags, followed by EarthReferenceData (~37%),
 * MeteoData (~32%), FlightId (~24%), AirReferenceData (~22%), and
 * WaypointChangeEvent (~22%).
 */

const tags = (msg: DatalinkMessage): AdscTag[] => {
  const payload = arinc622Message(msg)?.payload;
  return payload && "adsc" in payload ? payload.adsc : [];
};

const FLIGHT_LEVEL_MIN_FEET = 10_000;

const formatAltitude = (feet: number) =>
  feet < FLIGHT_LEVEL_MIN_FEET
    ? `${Math.round(feet)} ft`
    : `FL${Math.round(feet / 100)}`;

const formatSigned = (value: number, suffix: string) =>
  `${value > 0 ? "+" : ""}${Math.round(value)}${suffix}`;

const formatPosition = (report: AdscPositionReport) =>
  [
    `${report.latitude.toFixed(2)}° ${report.longitude.toFixed(2)}°`,
    report.altitude_ft == null ? null : formatAltitude(report.altitude_ft)
  ]
    .filter(Boolean)
    .join(" ");

const formatEta = (secondsPastHour: number, reportSecondsPastHour?: number) => {
  if (reportSecondsPastHour == null) {
    const normalized = ((Math.round(secondsPastHour) % 3600) + 3600) % 3600;
    const minute = Math.floor(normalized / 60);
    const second = normalized % 60;
    return `ETA :${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  const delta =
    ((secondsPastHour % 3600) - (reportSecondsPastHour % 3600) + 3600) % 3600;
  return `+${Math.round(delta / 60)}m`;
};

const reportMeta = (report: AdscPositionReport) => {
  const bits = [
    report.position_accuracy_code == null
      ? null
      : `pac ${report.position_accuracy_code}`,
    report.nav_redundancy_ok === false ? "nav degraded" : null,
    report.tcas_ok === false ? "tcas off" : null
  ].filter(Boolean);
  return bits.length ? ` (${bits.join(", ")})` : "";
};

const routePoint = (
  latitude: number,
  longitude: number,
  altitude?: number,
  eta?: number,
  reportSecondsPastHour?: number
) =>
  [
    `${latitude.toFixed(2)}° ${longitude.toFixed(2)}°`,
    altitude == null ? null : formatAltitude(altitude),
    eta == null ? null : formatEta(eta, reportSecondsPastHour)
  ]
    .filter(Boolean)
    .join(" ");

const routeRows = (
  route: AdscPredictedRoute,
  reportSecondsPastHour?: number
): SummaryRow[] => {
  const rows = [
    {
      meta: "next",
      detail: routePoint(
        route.next_latitude,
        route.next_longitude,
        route.next_altitude_ft,
        route.next_eta_seconds,
        reportSecondsPastHour
      )
    }
  ];
  if (route.next_next_latitude != null && route.next_next_longitude != null) {
    rows.push({
      meta: "next+1",
      detail: routePoint(
        route.next_next_latitude,
        route.next_next_longitude,
        route.next_next_altitude_ft
      )
    });
  }
  return rows;
};

const earthReferenceDetail = (value: AdscEarthReferenceData) => {
  const parts = [
    value.true_track_degrees == null || value.track_invalid
      ? null
      : `${Math.round(value.true_track_degrees)}°`,
    value.ground_speed_kt == null ? null : `${Math.round(value.ground_speed_kt)} kt`,
    value.vertical_speed_ft_per_min == null || value.vertical_speed_ft_per_min === 0
      ? null
      : formatSigned(value.vertical_speed_ft_per_min, " fpm")
  ].filter(Boolean);
  return parts.length ? `track ${parts.join(" ")}` : "track data";
};

const airReferenceDetail = (value: AdscAirReferenceData) => {
  const parts = [
    value.true_heading_degrees == null || value.heading_invalid
      ? null
      : `${Math.round(value.true_heading_degrees)}°`,
    value.mach == null ? null : `M${value.mach.toFixed(3)}`,
    value.vertical_speed_ft_per_min == null || value.vertical_speed_ft_per_min === 0
      ? null
      : formatSigned(value.vertical_speed_ft_per_min, " fpm")
  ].filter(Boolean);
  return parts.length ? `heading ${parts.join(" ")}` : "heading data";
};

const meteoDetail = (value: AdscMeteoData) => {
  const parts = [
    value.wind_speed_kt == null ||
    value.wind_direction_true_degrees == null ||
    value.wind_direction_invalid
      ? null
      : `wind ${Math.round(value.wind_direction_true_degrees)}°/${Math.round(
          value.wind_speed_kt
        )} kt`,
    value.temperature_c == null ? null : formatSigned(value.temperature_c, "°C")
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "meteo data";
};

const groupDetail = (group: AdscContractGroup) => {
  if (group === "waypoint_change") return "waypoint change";
  if ("flight_id" in group) return "flight id";
  if ("predicted_route" in group) return "route";
  if ("earth_reference_data" in group) return "earth ref";
  if ("air_reference_data" in group) return "air ref";
  if ("meteo_data" in group) return "meteo";
  if ("airframe_id" in group) return "airframe";
  if ("lateral_deviation_change" in group)
    return `lat dev >${group.lateral_deviation_change.threshold_nm} nm`;
  if ("vertical_speed_change" in group)
    return `vs ${formatSigned(group.vertical_speed_change.threshold_ft_per_min, " fpm")}`;
  if ("altitude_range" in group)
    return `alt ${formatAltitude(group.altitude_range.floor_ft)}-${formatAltitude(
      group.altitude_range.ceiling_ft
    )}`;
  return `intent +${group.aircraft_intent_data.projection_time_mins}m`;
};

const contractFeatureSummary = (groups: AdscContractGroup[]) => {
  const labels = groups.map(groupDetail);
  return labels.length ? `request ${labels.join(", ")}` : null;
};

const contractRows = (tag: AdscTag): SummaryRow[] => {
  if (typeof tag === "string") return [];
  if ("event_contract_request" in tag) {
    const data = tag.event_contract_request;
    return [
      {
        meta: "event contract",
        detail: [`#${data.contract_number}`, contractFeatureSummary(data.events)]
          .filter(Boolean)
          .join(" · ")
      }
    ];
  }

  const data =
    "periodic_contract_request" in tag
      ? tag.periodic_contract_request
      : "emergency_periodic_contract_request" in tag
        ? tag.emergency_periodic_contract_request
        : null;
  if (!data) return [];
  return [
    {
      meta:
        "periodic_contract_request" in tag ? "periodic contract" : "emergency contract",
      detail: [
        `#${data.contract_number}`,
        `every ${data.report_interval_secs}s`,
        contractFeatureSummary(data.requested_groups)
      ]
        .filter(Boolean)
        .join(" · ")
    }
  ];
};

const positionRow = (meta: string, report: AdscPositionReport): SummaryRow[] => [
  { meta, detail: `${formatPosition(report)}${reportMeta(report)}` }
];

const adscEnumLabel = (value: AdscNackReason | AdscNoncompliantTag) => {
  if (typeof value === "string") return value.replaceAll("_", " ");
  const unknown = value.unknown;
  return "code" in unknown
    ? `unknown (code ${unknown.code})`
    : `unknown (tag ${unknown.tag})`;
};

const noncomplianceDetail = (value: AdscNoncomplianceNotification) => {
  const groups = value.groups.map(group => adscEnumLabel(group.noncompliant_tag));
  return (
    [
      `request #${value.contract_request_number}`,
      groups.length ? groups.join(", ") : null
    ]
      .filter(Boolean)
      .join(" · ") || "contract cannot be satisfied"
  );
};

const positionReport = (tag: AdscTag): AdscPositionReport | undefined => {
  if (typeof tag === "string") return undefined;
  if ("basic_report" in tag) return tag.basic_report;
  if ("emergency_basic_report" in tag) return tag.emergency_basic_report;
  if ("lateral_deviation_change_event" in tag)
    return tag.lateral_deviation_change_event;
  if ("vertical_rate_change_event" in tag) return tag.vertical_rate_change_event;
  if ("altitude_range_event" in tag) return tag.altitude_range_event;
  if ("waypoint_change_event" in tag) return tag.waypoint_change_event;
  return undefined;
};

const rowsForTag = (tag: AdscTag, reportSecondsPastHour?: number): SummaryRow[] => {
  if (tag === "cancel_emergency_mode")
    return [{ meta: "emergency", detail: "cancel emergency mode" }];
  if (tag === "cancel_all_contracts")
    return [{ meta: "cancel", detail: "all contracts" }];
  if ("acknowledgement" in tag)
    return [
      { meta: "ack", detail: `contract #${tag.acknowledgement.contract_number}` }
    ];
  if ("negative_acknowledgement" in tag) {
    const data = tag.negative_acknowledgement;
    return [
      {
        meta: "nak",
        detail: [
          `request #${data.contract_request_number}`,
          adscEnumLabel(data.reason)
        ].join(" · ")
      }
    ];
  }
  if ("noncompliance_notification" in tag)
    return [
      {
        meta: "noncompliance",
        detail: noncomplianceDetail(tag.noncompliance_notification)
      }
    ];
  if ("basic_report" in tag) return positionRow("report", tag.basic_report);
  if ("emergency_basic_report" in tag)
    return positionRow("emergency", tag.emergency_basic_report);
  if ("lateral_deviation_change_event" in tag)
    return positionRow("lat dev", tag.lateral_deviation_change_event);
  if ("vertical_rate_change_event" in tag)
    return positionRow("vs event", tag.vertical_rate_change_event);
  if ("altitude_range_event" in tag)
    return positionRow("alt range", tag.altitude_range_event);
  if ("waypoint_change_event" in tag)
    return positionRow("waypoint", tag.waypoint_change_event);
  if ("flight_id" in tag) return [{ meta: "flight", detail: tag.flight_id.callsign }];
  if ("predicted_route" in tag)
    return routeRows(tag.predicted_route, reportSecondsPastHour);
  if ("earth_reference_data" in tag)
    return [{ meta: "earth", detail: earthReferenceDetail(tag.earth_reference_data) }];
  if ("air_reference_data" in tag)
    return [{ meta: "air", detail: airReferenceDetail(tag.air_reference_data) }];
  if ("meteo_data" in tag)
    return [{ meta: "meteo", detail: meteoDetail(tag.meteo_data) }];
  if ("airframe_id" in tag)
    return [{ meta: "airframe", detail: `icao24 ${tag.airframe_id.icao24}` }];
  if ("intermediate_projection" in tag)
    return [{ meta: "intent", detail: "intermediate projected intent" }];
  if ("fixed_projection" in tag)
    return [{ meta: "intent", detail: "fixed projected intent" }];
  if ("cancel_contract" in tag)
    return [
      { meta: "cancel", detail: `contract #${tag.cancel_contract.contract_number}` }
    ];
  return contractRows(tag);
};

const rows = computed<SummaryRow[]>(() => {
  const disconnect = adscDisconnectReason(props.msg);
  if (disconnect)
    return [{ meta: "disconnect", detail: disconnect.replaceAll("_", " ") }];

  const decodedTags = tags(props.msg);
  const reference = decodedTags
    .map(positionReport)
    .find(
      report => report?.timestamp_seconds_past_hour != null
    )?.timestamp_seconds_past_hour;
  return decodedTags.flatMap(tag => rowsForTag(tag, reference));
});
</script>
