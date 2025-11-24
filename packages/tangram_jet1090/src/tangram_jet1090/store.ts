import { reactive } from "vue";

export const selectedAircraft = reactive({
  icao24: null as string | null,
  trajectory: [] as any[],
  loading: false,
  error: null as string | null
});
