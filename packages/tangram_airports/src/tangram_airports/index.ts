import type { TangramApi } from "@open-aviation/tangram-core/api";
import { airport_information } from "rs1090-wasm";
import AirportSearchWidget from "./AirportSearchWidget.vue";

export function install(api: TangramApi) {
  api.search.registerProvider({
    id: "airports",
    name: "Airports",
    search: async (query, signal) => {
      if (query.length < 3 || signal.aborted) return [];

      const airports = airport_information(query);
      return airports.slice(0, 10).map(a => ({
        id: `airport-${a.icao}`,
        component: AirportSearchWidget,
        props: {
          name: a.name,
          city: a.city,
          countryCode: a.countryCode,
          iata: a.iata,
          icao: a.icao
        },
        score: 100,
        onSelect: () => {
          api.map.getMapInstance().flyTo({
            center: [a.lon, a.lat],
            zoom: 13,
            speed: 1.2
          });
        }
      }));
    }
  });
}
