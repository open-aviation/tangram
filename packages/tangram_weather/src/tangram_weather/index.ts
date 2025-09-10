import type { TangramApi } from "@open-aviation/tangram/api";
import WeatherWidget from "./WeatherWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("weather-widget", "SideBar", WeatherWidget);
}
