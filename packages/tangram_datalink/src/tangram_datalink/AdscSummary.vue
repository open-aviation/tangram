<template>
  <MessageSummaryParts :parts="parts" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import MessageSummaryParts from "./MessageSummaryParts.vue";
import type { DatalinkMessage } from "./store";
import {
  arrayField,
  decodedArincPayload,
  isRecord,
  numberField,
  stringField
} from "./summary_helpers";

const props = defineProps<{ msg: DatalinkMessage }>();

const requestKinds = new Set([
  "PeriodicContractRequest",
  "EventContractRequest",
  "EmergencyPeriodicContractRequest",
  "CancelAllContracts",
  "CancelContract"
]);

const formatPosition = (value: unknown) => {
  const latitude = numberField(value, "latitude");
  const longitude = numberField(value, "longitude");
  if (latitude == null || longitude == null) return null;

  const altitude = numberField(value, "altitude_ft");
  return altitude == null
    ? `${latitude.toFixed(4)}° ${longitude.toFixed(4)}°`
    : `${latitude.toFixed(4)}° ${longitude.toFixed(4)}° FL${Math.round(altitude / 100)}`;
};

const parts = computed(() => {
  const payload = decodedArincPayload(props.msg);
  const tags = arrayField(payload, "tags").filter(isRecord);
  const isUplink = tags.some(tag =>
    Object.keys(tag).some(key => requestKinds.has(key))
  );
  if (isUplink) return ["uplink", "contract"];

  const out = ["downlink"];
  for (const tag of tags) {
    const flightId = isRecord(tag.FlightId)
      ? stringField(tag.FlightId, "id")
      : undefined;
    if (flightId) out.push(`flight ${flightId}`);

    const report =
      tag.BasicReport ??
      tag.EmergencyBasicReport ??
      tag.WaypointChangeEvent ??
      tag.LateralDeviationChangeEvent ??
      tag.VerticalRateChangeEvent ??
      tag.AltitudeRangeEvent;
    const position = formatPosition(report);
    if (position) out.push(position);

    const earth = tag.EarthReferenceData;
    const track = numberField(earth, "heading_or_track_degrees");
    const speed = numberField(earth, "speed");
    const verticalSpeed = numberField(earth, "vertical_speed_ft_per_min");
    if (track != null || speed != null || verticalSpeed != null) {
      out.push(
        [
          track == null ? null : `${Math.round(track)}°`,
          speed == null ? null : `${Math.round(speed)} kt`,
          verticalSpeed == null || verticalSpeed === 0
            ? null
            : `${verticalSpeed > 0 ? "↑" : "↓"}${Math.abs(verticalSpeed)} fpm`
        ]
          .filter(Boolean)
          .join(" · ")
      );
    }

    if (isRecord(tag.PredictedRoute)) {
      const latitude = numberField(tag.PredictedRoute, "next_latitude");
      const longitude = numberField(tag.PredictedRoute, "next_longitude");
      const altitude = numberField(tag.PredictedRoute, "next_altitude_ft");
      const eta = numberField(tag.PredictedRoute, "next_eta_seconds");
      if (latitude != null && longitude != null) {
        out.push(
          `next ${latitude.toFixed(3)}° ${longitude.toFixed(3)}°${
            altitude == null ? "" : ` FL${Math.round(altitude / 100)}`
          }${eta == null ? "" : ` in ${Math.round(eta / 60)} min`}`
        );
      }
    }
  }

  return out;
});
</script>
