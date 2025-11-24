import { reactive } from "vue";

export const selectedShip = reactive({
  id: null as string | null,
  trajectory: [] as any[],
  loading: false,
  error: null as string | null
});
