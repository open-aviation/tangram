import type { TangramApi } from "@open-aviation/tangram/api";
import AirportSearchWidget from "./AirportSearchWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("airport-search-widget", "MapOverlay", AirportSearchWidget);
}
