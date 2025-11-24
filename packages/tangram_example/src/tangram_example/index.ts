import type { TangramApi } from "@open-aviation/tangram-core/api";
import ExampleWidget from "./ExampleWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("example-widget", "SideBar", ExampleWidget);
}
