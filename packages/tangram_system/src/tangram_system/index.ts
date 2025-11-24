import type { TangramApi } from "@open-aviation/tangram-core/api";
import SystemWidget from "./SystemWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("system-widget", "TopBar", SystemWidget);
}
