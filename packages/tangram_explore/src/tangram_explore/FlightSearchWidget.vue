<template>
  <div class="flight-search">
    <input
      v-model="query"
      type="text"
      placeholder="Search for a flight..."
      @input="onInput"
      @focus="inputFocused = true"
      @blur="handleBlur"
    />

    <ul v-if="inputFocused && filtered.length > 0" class="search-results">
      <li
        v-for="flight in filtered"
        :key="flight.interval_id"
        @click="selectFlight(flight)"
      >
        <span class="callsign">{{ flight.callsign }}</span>
        <span class="icao24 chip yellow">{{ flight.icao24 }}</span>
        <span class="duration">{{ formatDuration(flight.duration) }}</span>
        <br />
        <span class="start_ts">{{ formatTime(flight.start_ts, true) }}</span>
        to
        <span class="end_ts">{{ formatTime(flight.end_ts, false) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, onMounted } from "vue";
import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";

interface FlightInfo {
  icao24: string;
  callsign: string;
  start_ts: string;
  end_ts: string;
  n_rows: number;
  duration: number;
  interval_id: number;
}

const query = ref("");
const results = ref<FlightInfo[]>([]);
const filtered = ref<FlightInfo[]>([]);
const inputFocused = ref(false);

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) throw new Error("assert: tangram api not provided");

const layerDisposables = new Map<string, Disposable>();

const handleBlur = () => {
  // Delay setting inputFocused to false to allow @click to trigger first
  setTimeout(() => {
    inputFocused.value = false;
  }, 1000);
};

const formatTime = (ts: string, include_day: boolean) => {
  const date = new Date(ts + "Z");
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  const day = date.getUTCDate();
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  if (include_day) {
    return `${pad(day)} ${date.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${year} ${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}:${seconds}`;
};

const formatDuration = (duration: number) => {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
};

onMounted(() => {
  fetch("/explore/stats")
    .then(response => response.json())
    .then(data => {
      results.value = data;
      filtered.value = data;
    });
  console.log("FlightSearchWidget mounted, fetched flight stats");
});

const onInput = () => {
  const q = query.value.trim().toLowerCase();
  filtered.value = results.value.filter(
    flight =>
      flight.callsign.toLowerCase().includes(q) ||
      flight.icao24.toLowerCase().includes(q)
  );
  console.log("Filtered results:", filtered.value);
};

type Color = [number, number, number, number];
function hexToRgb(hex: string): Color {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255]
    : [128, 0, 128, 255];
}

const selectFlight = (flight: FlightInfo) => {
  console.log("Selected flight:", flight);
  query.value = "";
  const start_ts = new Date(flight.start_ts + "Z").getTime();
  const end_ts = new Date(flight.end_ts + "Z").getTime();
  fetch(
    `/explore/history/${flight.icao24}/${Math.floor(start_ts)}/${Math.floor(end_ts)}`
  )
    .then(response => response.json())
    .then(data => {
      const layers: Layer[] = [];
      //const pathData: { path: number[][]; colors: Color[] }[] = [];

      // Split data into segments: continuous (solid) and gaps (>10min, dashed)
      const MAX_GAP_SECONDS = 600; // 10 minutes
      const segments: { path: number[][]; colors: Color[]; dashed: boolean }[] = [];
      let currentSegment: {
        path: number[][];
        colors: Color[];
        dashed: boolean;
      } | null = null;
      let lastPoint: any = null;

      for (const point of data) {
        if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
          // skip invalid points
          continue;
        }
        if (
          lastPoint &&
          Math.abs(
            new Date(point.timestamp).getTime() -
              new Date(lastPoint.timestamp).getTime()
          ) /
            1000 >
            MAX_GAP_SECONDS
        ) {
          // gap detected, close current segment and start a new dashed one
          if (currentSegment && currentSegment.path.length > 1) {
            segments.push(currentSegment);
          }

          // Add a dashed black line to connect the segments
          if (lastPoint) {
            segments.push({
              path: [
                [lastPoint.longitude, lastPoint.latitude],
                [point.longitude, point.latitude]
              ],
              colors: [hexToRgb("#bab0ac"), hexToRgb("#bab0ac")], // Black dashed line
              dashed: true
            });
          }
          // Start a new solid segment
          currentSegment = {
            path: [],
            colors: [],
            dashed: false
          };
        }
        if (!currentSegment) {
          currentSegment = {
            path: [],
            colors: [],
            dashed: false
          };
        }
        currentSegment.path.push([point.longitude, point.latitude]);
        currentSegment.colors.push(hexToRgb("#4c78a8"));
        lastPoint = point;
      }
      if (currentSegment && currentSegment.path.length > 1) {
        segments.push(currentSegment);
      }

      // Now, for each segment, push a PathLayer with solid or dashed style
      segments.forEach((segment, idx) => {
        layers.push(
          new PathLayer({
            id: `jet1090-trails-path-${idx}`,
            data: [{ path: segment.path, colors: segment.colors }],
            pickable: false,
            widthScale: 1,
            widthMinPixels: 2,
            getPath: d => d.path,
            getColor: d => d.colors,
            getWidth: segment.dashed ? 1 : 2,
            parameters: {
              depthTest: false
            },
            ...(segment.dashed
              ? {
                  // Deck.gl PathLayer supports dash arrays
                  extensions: [new PathStyleExtension({ dash: true })],
                  getDashArray: [5, 5],
                  dashJustified: true
                }
              : {})
          })
        );
      });
      /*const pathPoints: number[][] = data
        .filter((p: any) => Number.isFinite(p.latitude))
        .map((p: any) => [p.longitude, p.latitude]);

      const trailColor = "#4c78a8";
      const a = Math.round(0.6 * 255);

      const rgb = hexToRgb(trailColor);
      const color: Color = [rgb[0], rgb[1], rgb[2], a];

      pathData.push({ path: pathPoints, colors: pathPoints.map(() => color) });
      if (pathData.length > 0) {
        layers.push(
          new PathLayer({
            id: `jet1090-trails-path`,
            data: pathData,
            pickable: false,
            widthScale: 1,
            widthMinPixels: 2,
            getPath: d => d.path,
            getColor: d => d.colors,
            getWidth: 2
          })
        );
      }*/

      const currentIds = new Set(layers.map(l => l.id));

      for (const [id, disposable] of layerDisposables) {
        if (!currentIds.has(id)) {
          disposable.dispose();
          layerDisposables.delete(id);
        }
      }

      for (const layer of layers) {
        if (!layerDisposables.has(layer.id)) {
          layerDisposables.set(layer.id, tangramApi.map.setLayer(layer));
        } else {
          tangramApi.map.setLayer(layer);
        }
      }
    });
};
</script>

<style scoped>
.flight-search {
  position: absolute;
  width: 300px;
  z-index: 1000;
  top: 50px;
  right: 10px;
}

.flight-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 10px;
  font-family: "B612", sans-serif;
  box-sizing: border-box;
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 0;
  margin: 4px 0 0 0;
  list-style: none;
  background: #fff;
  border: 1px solid #ccc;
  z-index: 1001;
  max-height: 200px;
  overflow-y: auto;
  font-family: "B612", sans-serif;
}

.search-results li {
  padding: 5px 10px;
  cursor: pointer;
}

.search-results li:hover {
  background-color: #eee;
}
.callsign {
  font-weight: normal;
  margin-right: 10px;
}

.duration {
  float: right;
  font: "Inconsolata", monospace;
  font-size: 1em;
}

.chip {
  border-radius: 5px;
  padding: 0px 5px;
  font-family: "Inconsolata", monospace;
  font-size: 1em;
}

.chip.blue {
  background-color: #4c78a8;
  color: white;
  border: 1px solid #4c78a8;
}

.chip.yellow {
  background-color: #f2cf5b;
  color: black;
  border: 1px solid #e0c050;
}
</style>
