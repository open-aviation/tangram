import type { TangramApi } from "@open-aviation/tangram-core/api";
import SystemWidget from "./SystemWidget.vue";

interface SystemConfig {
  topbar_order: number;
}

export function install(api: TangramApi, config?: SystemConfig) {
  api.ui.registerWidget("system-widget", "TopBar", SystemWidget, {
    priority: config?.topbar_order
  });
}
