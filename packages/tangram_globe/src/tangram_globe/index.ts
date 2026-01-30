import { watch } from "vue";
import type { TangramApi } from "@open-aviation/tangram-core/api";

export function install(api: TangramApi) {
  watch(
    () => api.settings.tangram_globe?.values.enabled,
    enabled => {
      if (!api.map.isReady.value) return;
      const mapInstance = api.map.getMapInstance();
      mapInstance.setProjection(enabled ? { type: "globe" } : { type: "mercator" });
    },
    { immediate: true }
  );

  watch(api.map.isReady, ready => {
    if (ready && api.settings.tangram_globe?.values.enabled) {
      api.map.getMapInstance().setProjection({ type: "globe" });
    }
  });
}
