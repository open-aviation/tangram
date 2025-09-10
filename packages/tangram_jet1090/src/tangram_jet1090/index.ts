import type { TangramApi } from "@open-aviation/tangram/api";
import Jet1090Widget from "./Jet1090Widget.vue";

export function install(api: TangramApi) {
  api.ui.registerWidget("jet1090-widget", "SideBar", Jet1090Widget);
}
