import type { TangramApi } from "@open-aviation/tangram/api";
import ExampleWidget from "./ExampleWidget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("example-widget", "SideBar", ExampleWidget);
}
