import type { PluginContext } from "@open-aviation/tangram-core/api";
import SystemWidget from "./SystemWidget.vue";

interface SystemConfig {
  topbar_order: number;
}

export function install(ctx: PluginContext, config?: SystemConfig) {
  ctx.api.ui.registerWidget("system-widget", "TopBar", SystemWidget, {
    pluginId: ctx.id,
    priority: config?.topbar_order
  });
}
