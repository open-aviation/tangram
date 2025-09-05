import type { TangramApi } from "@open-aviation/tangram/types";
import ExampleWidget from "./ExampleWidget.vue";

export function install(api: TangramApi) {
  api.registerWidget("example", ExampleWidget);
}
