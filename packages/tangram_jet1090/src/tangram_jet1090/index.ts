import type { TangramApi } from "@open-aviation/tangram/types";
import Jet1090Widget from "./Jet1090Widget.vue";

export function install(api: TangramApi) {
  api.registerWidget("jet1090", Jet1090Widget);
}
