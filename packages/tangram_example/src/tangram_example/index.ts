import type { PluginContext } from "@open-aviation/tangram-core/api";
import ExampleWidget from "./ExampleWidget.vue";

export function install(ctx: PluginContext) {
  ctx.api.ui.registerWidget("example-widget", "SideBar", ExampleWidget, {
    pluginId: ctx.id,
    title: "Example Widget"
  });
}
