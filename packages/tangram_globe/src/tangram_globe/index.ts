import { watch } from "vue";
import type { PluginContext } from "@open-aviation/tangram-core/api";

export function install(ctx: PluginContext) {
  const api = ctx.api;

  ctx.onDispose({
    dispose: watch(
      () => api.settings.tangram_globe?.values.enabled,
      enabled => {
        if (!api.map.isReady.value) return;
        const mapInstance = api.map.getMapInstance();
        mapInstance.setProjection(enabled ? { type: "globe" } : { type: "mercator" });
      },
      { immediate: true }
    )
  });

  ctx.onDispose({
    dispose: watch(api.map.isReady, ready => {
      if (ready && api.settings.tangram_globe?.values.enabled) {
        api.map.getMapInstance().setProjection({ type: "globe" });
      }
    })
  });
}
