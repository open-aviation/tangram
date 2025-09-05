import type { TangramApi } from "@open-aviation/tangram/types";
import WeatherWidget from "./WeatherWidget.vue";

export function install(api: TangramApi) {
  api.registerWidget("weather", WeatherWidget);
}
