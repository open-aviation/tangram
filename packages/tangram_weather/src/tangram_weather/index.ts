import type { TangramApi } from "@open-aviation/tangram-core/api";
import type { PluginUiConfig } from "@open-aviation/tangram-core/plugin";
import WindFieldLayer from "./WindFieldLayer.vue";

export function install(api: TangramApi, config?: PluginUiConfig) {
  api.ui.registerWidget("wind-field-layer", "MapOverlay", WindFieldLayer, {
    priority: config?.topbar_order
  });
}
