import type { TangramApi, SearchResult } from "@open-aviation/tangram-core/api";
import FlightSearchWidget from "./FlightSearchWidget.vue";
import FlightGroupResult from "./FlightGroupResult.vue";
import FlightIntervalResult from "./FlightIntervalResult.vue";
import { flightStore, type FlightInfo } from "./store";

export function install(api: TangramApi) {
  api.ui.registerWidget("historical-flight-layer", "MapOverlay", FlightSearchWidget);

  api.search.registerProvider({
    id: "flights-history",
    name: "Flights (History)",
    search: async (query, signal) => {
      if (query.length < 3) return [];
      try {
        const res = await fetch(`/explore/search?q=${encodeURIComponent(query)}`, {
          signal
        });
        if (!res.ok) return [];
        const intervals: FlightInfo[] = await res.json();

        const groups = new Map<string, FlightInfo[]>();
        for (const iv of intervals) {
          const key = `${iv.icao24}|${iv.callsign || "Unknown"}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(iv);
        }

        const results: SearchResult[] = [];
        for (const [key, groupIntervals] of groups) {
          const [icao24, callsign] = key.split("|");

          results.push({
            id: `group-${key}`,
            component: FlightGroupResult,
            props: {
              icao24,
              callsign
            },
            score: 80,
            children: groupIntervals.map(f => ({
              id: `flight-${f.icao24}-${f.start_ts}`,
              component: FlightIntervalResult,
              props: {
                start_ts: f.start_ts,
                end_ts: f.end_ts,
                duration: f.duration
              },
              onSelect: () => {
                flightStore.selectedFlight = f;
                flightStore.version++;
                if (f.lat && f.lon) {
                  api.map.getMapInstance().flyTo({
                    center: [f.lon, f.lat],
                    zoom: 8
                  });
                }
              }
            }))
          });
        }
        return results;
      } catch {
        return [];
      }
    }
  });
}
