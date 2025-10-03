import type { TangramApi } from "@open-aviation/tangram/api";
import WindFieldLayer from "./WindFieldLayer.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("wind-field-layer", "MapOverlay", WindFieldLayer);
}
