import type { PluginContext } from "@open-aviation/tangram-core/api";
import WindFieldLayer from "./WindFieldLayer.vue";

interface WeatherConfig {
  topbar_order?: number;
}

export function install(ctx: PluginContext, config?: WeatherConfig) {
  ctx.api.ui.registerWidget("wind-field-layer", "MapOverlay", WindFieldLayer, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });
}
