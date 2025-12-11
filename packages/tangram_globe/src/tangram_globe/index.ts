import type { TangramApi } from "@open-aviation/tangram-core/api";
import GlobeToggle from "./GlobeToggle.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("globe-toggle", "TopBar", GlobeToggle);
}
