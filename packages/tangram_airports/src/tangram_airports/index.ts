import type { PluginContext } from "@open-aviation/tangram-core/api";
import AirportSearchWidget from "./AirportSearchWidget.vue";

interface AirportSearchEntry {
  name: string;
  city: string;
  countryCode: string;
  iata: string;
  icao: string;
  lon: number;
  lat: number;
}

export async function install(ctx: PluginContext) {
  // metadata is a plugin-level prerequisite. progressive degradation is deferred
  const rs1090 =
    await ctx.importModule<typeof import("rs1090-wasm/web")>("rs1090_wasm.js");
  // NOTE: copied wasm-bindgen loader resolves sibling wasm through import.meta.url
  await rs1090.default();
  rs1090.run();
  const api = ctx.api;

  api.search.registerProvider({
    id: "airports",
    pluginId: ctx.id,
    name: "Airports",
    search: async (query, signal) => {
      if (query.length < 3 || signal.aborted) return [];

      const airports = rs1090.airport_information(query) as AirportSearchEntry[];
      return airports.slice(0, 10).map(airport => ({
        id: `airport-${airport.icao}`,
        component: AirportSearchWidget,
        props: {
          name: airport.name,
          city: airport.city,
          countryCode: airport.countryCode,
          iata: airport.iata,
          icao: airport.icao
        },
        score: 100,
        onSelect: () => {
          api.map.getMapInstance().flyTo({
            center: [airport.lon, airport.lat],
            zoom: 13,
            speed: 1.2
          });
        }
      }));
    }
  });
}
