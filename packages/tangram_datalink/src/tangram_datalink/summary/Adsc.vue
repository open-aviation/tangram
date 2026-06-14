<template>
  <SummaryRows :rows="rows" empty="ads-c" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  AdscContractGroup,
  AdscMeteoData,
  AdscPayload,
  AdscPositionReport,
  AdscPredictedRoute,
  AdscReferenceData,
  AdscTag,
  DatalinkMessage
} from "../types";
import { arinc622Message } from "../summary_helpers";
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
  if (payload?.kind !== "adsc") return [];
  return ((payload.data as AdscPayload).tags ?? []) as AdscTag[];
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

const formatEta = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes <= 0 ? "+0m" : `+${minutes}m`;
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
  eta?: number
) =>
  [
    `${latitude.toFixed(2)}° ${longitude.toFixed(2)}°`,
    altitude == null ? null : formatAltitude(altitude),
    eta == null ? null : formatEta(eta)
  ]
    .filter(Boolean)
    .join(" ");

const routeRows = (route: AdscPredictedRoute): SummaryRow[] => {
  const rows = [
    {
      meta: "next",
      detail: routePoint(
        route.next_latitude,
        route.next_longitude,
        route.next_altitude_ft,
        route.next_eta_seconds
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

const referenceDetail = (value: AdscReferenceData, label: string) => {
  const parts = [
    value.heading_or_track_degrees == null || value.heading_invalid
      ? null
      : `${Math.round(value.heading_or_track_degrees)}°`,
    value.speed == null ? null : `${Math.round(value.speed)} kt`,
    value.vertical_speed_ft_per_min == null || value.vertical_speed_ft_per_min === 0
      ? null
      : formatSigned(value.vertical_speed_ft_per_min, " fpm")
  ].filter(Boolean);
  return parts.length ? `${label} ${parts.join(" ")}` : `${label} data`;
};

const meteoDetail = (value: AdscMeteoData) => {
  const parts = [
    value.wind_speed_kt == null || value.wind_direction_invalid
      ? null
      : `wind ${Math.round(value.wind_direction_true_degrees ?? 0)}°/${Math.round(
          value.wind_speed_kt
        )} kt`,
    value.temperature_c == null ? null : formatSigned(value.temperature_c, "°C")
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "meteo data";
};

const contractGroupLabel = (group: AdscContractGroup) => {
  switch (group.kind) {
    case "report_interval":
      return group.data.interval_secs == null
        ? "interval"
        : `every ${group.data.interval_secs}s`;
    case "flight_id":
      return "flight id";
    case "predicted_route":
      return "route";
    case "earth_reference_data":
      return "earth ref";
    case "air_reference_data":
      return "air ref";
    case "meteo_data":
      return "meteo";
    case "airframe_id":
      return "airframe";
    case "aircraft_intent_data":
      return group.data.projection_time_mins == null
        ? "intent"
        : `intent +${group.data.projection_time_mins}m`;
    default:
      return null;
  }
};

const groupDetail = (group: AdscContractGroup) => {
  switch (group.kind) {
    case "report_interval":
      return group.data.interval_secs == null
        ? "interval"
        : `every ${group.data.interval_secs}s`;
    case "flight_id":
      return "flight id";
    case "predicted_route":
      return "route";
    case "earth_reference_data":
      return "earth ref";
    case "air_reference_data":
      return "air ref";
    case "meteo_data":
      return "meteo";
    case "airframe_id":
      return "airframe";
    case "lateral_deviation_change":
      return group.data.threshold_nm == null
        ? "lat dev"
        : `lat dev >${group.data.threshold_nm} nm`;
    case "vertical_speed_change":
      return group.data.threshold_ft_per_min == null
        ? "vs change"
        : `vs ${formatSigned(group.data.threshold_ft_per_min, " fpm")}`;
    case "altitude_range":
      return group.data.floor_ft == null || group.data.ceiling_ft == null
        ? "alt range"
        : `alt ${formatAltitude(group.data.floor_ft)}-${formatAltitude(group.data.ceiling_ft)}`;
    case "report_waypoint_changes":
      return "waypoint change";
    case "aircraft_intent_data":
      return group.data.projection_time_mins == null
        ? "intent"
        : `intent +${group.data.projection_time_mins}m`;
    default:
      return group.kind.replaceAll("_", " ");
  }
};

const contractFeatureSummary = (groups: AdscContractGroup[]) => {
  const labels = groups
    .map(contractGroupLabel)
    .filter((label): label is string => Boolean(label));
  if (!labels.length) return null;
  return `request ${labels.join(", ")}`;
};

const contractRows = (
  tag: Extract<
    AdscTag,
    {
      kind:
        | "periodic_contract_request"
        | "event_contract_request"
        | "emergency_periodic_contract_request";
    }
  >
): SummaryRow[] => {
  const label =
    tag.kind === "periodic_contract_request"
      ? "periodic contract"
      : tag.kind === "event_contract_request"
        ? "event contract"
        : "emergency contract";
  const groups = tag.data.groups ?? [];
  const reportInterval = groups.find(group => group.kind === "report_interval");
  return [
    {
      meta: label,
      detail: [
        tag.data.contract_number == null ? null : `#${tag.data.contract_number}`,
        reportInterval ? groupDetail(reportInterval) : null,
        contractFeatureSummary(groups.filter(group => group.kind !== "report_interval"))
      ]
        .filter(Boolean)
        .join(" · ")
    }
  ];
};

const positionRow = (meta: string, report: AdscPositionReport): SummaryRow[] => [
  { meta, detail: `${formatPosition(report)}${reportMeta(report)}` }
];

const rowsForTag = (tag: AdscTag): SummaryRow[] => {
  switch (tag.kind) {
    case "acknowledgement":
      return [
        {
          meta: "ack",
          detail:
            tag.data.contract_number == null
              ? "contract"
              : `contract #${tag.data.contract_number}`
        }
      ];
    case "negative_acknowledgement":
      return [
        {
          meta: "nak",
          detail:
            [
              tag.data.contract_request_number == null
                ? null
                : `request #${tag.data.contract_request_number}`,
              tag.data.reason
            ]
              .filter(Boolean)
              .join(" · ") || "request rejected"
        }
      ];
    case "noncompliance_notification":
      return [{ meta: "noncompliance", detail: "contract cannot be satisfied" }];
    case "cancel_emergency_mode":
      return [{ meta: "emergency", detail: "cancel emergency mode" }];
    case "basic_report":
      return positionRow("report", tag.data);
    case "emergency_basic_report":
      return positionRow("emergency", tag.data);
    case "lateral_deviation_change_event":
      return positionRow("lat dev", tag.data);
    case "vertical_rate_change_event":
      return positionRow("vs event", tag.data);
    case "altitude_range_event":
      return positionRow("alt range", tag.data);
    case "waypoint_change_event":
      return positionRow("waypoint", tag.data);
    case "flight_id":
      return tag.data.id ? [{ meta: "flight", detail: tag.data.id }] : [];
    case "predicted_route":
      return routeRows(tag.data);
    case "earth_reference_data":
      return [{ meta: "earth", detail: referenceDetail(tag.data, "track") }];
    case "air_reference_data":
      return [{ meta: "air", detail: referenceDetail(tag.data, "heading") }];
    case "meteo_data":
      return [{ meta: "meteo", detail: meteoDetail(tag.data) }];
    case "airframe_id":
      return [{ meta: "airframe", detail: "icao address group" }];
    case "intermediate_projection":
      return [{ meta: "intent", detail: "intermediate projected intent" }];
    case "fixed_projection":
      return [{ meta: "intent", detail: "fixed projected intent" }];
    case "cancel_all_contracts":
      return [{ meta: "cancel", detail: "all contracts" }];
    case "cancel_contract":
      return [
        {
          meta: "cancel",
          detail:
            tag.data.contract_number == null
              ? "contract"
              : `contract #${tag.data.contract_number}`
        }
      ];
    case "periodic_contract_request":
    case "event_contract_request":
    case "emergency_periodic_contract_request":
      return contractRows(tag);
    default:
      return [{ meta: tag.kind, detail: "unrendered ADS-C tag" }];
  }
};

const rows = computed(() => tags(props.msg).flatMap(rowsForTag));
</script>
