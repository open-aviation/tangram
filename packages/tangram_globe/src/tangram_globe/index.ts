import type { TangramApi } from "@open-aviation/tangram-core/api";
import GlobeToggle from "./GlobeToggle.vue";

export function install(api: TangramApi, config?: SystemConfig) {
  api.ui.registerWidget("globe-toggle", "TopBar", GlobeToggle, {
    priority: config?.topbar_order
  });
}
