import { reactive } from "vue";
import type { Ship162Vessel } from ".";

export const selectedShip = reactive({
  id: null as string | null,
  trajectory: [] as Ship162Vessel[],
  loading: false,
  error: null as string | null
});
