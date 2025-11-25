import { reactive } from "vue";

export interface AirportInfo {
  lat: number | null;
  lon: number | null;
  name: string;
  city: string;
  icao: string;
}

export const selectedAircraft = reactive({
  icao24: null as string | null,
  trajectory: [] as any[],
  loading: false,
  error: null as string | null,
  route: {
    origin: null as AirportInfo | null,
    destination: null as AirportInfo | null
  }
});

export const pluginConfig = reactive({
  showRouteLines: true
});
