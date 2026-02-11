import { reactive } from "vue";
import type { TangramApi, JsonSchema } from "./api";

type PluginProgressStage = "manifest" | "plugin" | "done";
type PluginProgress = {
  stage: PluginProgressStage;
  pluginName?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginConfig = Record<string, any>;

export async function loadPlugins(
  tangramApi: TangramApi,
  onProgress?: (progress: PluginProgress) => void
) {
  onProgress?.({ stage: "manifest" });

  const loadPromises = Object.entries(tangramApi.manifest.plugins).map(
    async ([pluginName, meta]) => {
      const pluginMeta = meta as {
        main: string;
        style?: string;
        config?: PluginConfig;
        config_json_schema?: JsonSchema;
      };

      onProgress?.({ stage: "plugin", pluginName });

      if (pluginMeta.config) {
        tangramApi.settings[pluginName] = {
          values: reactive({ ...pluginMeta.config }),
          schema: pluginMeta.config_json_schema || {},
          errors: reactive({})
        };
      }

      if (pluginMeta.style) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/plugins/${pluginName}/${pluginMeta.style}`;
        document.head.appendChild(link);
      }

      if (!pluginMeta.main) return;

      const entryPointUrl = `/plugins/${pluginName}/${pluginMeta.main}`;

      try {
        const pluginModule = await import(/* @vite-ignore */ entryPointUrl);
        if (pluginModule.install) {
          pluginModule.install(
            tangramApi,
            tangramApi.settings[pluginName]?.values ?? pluginMeta.config
          );
        }
      } catch (e) {
        console.error(`failed to load plugin "${pluginName}":`, e);
      }
    }
  );

  await Promise.all(loadPromises);
  onProgress?.({ stage: "done" });
}
