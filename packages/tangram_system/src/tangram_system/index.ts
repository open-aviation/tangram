import type { TangramApi } from "@open-aviation/tangram/types";
import SystemWidget from "./SystemWidget.vue";

export function install(api: TangramApi) {
  api.registerWidget("system", SystemWidget);
}
