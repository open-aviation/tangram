import type { TangramApi } from "@open-aviation/tangram-core/api";
import FlightSearchWidget from "./FlightSearchWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("flight-search-widget", "MapOverlay", FlightSearchWidget);
}
