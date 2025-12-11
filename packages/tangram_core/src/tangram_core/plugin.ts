import type { TangramApi } from "./api";

type PluginProgressStage = "manifest" | "plugin" | "done";
type PluginProgress = {
  stage: PluginProgressStage;
  pluginName?: string;
};

export type PluginConfig = unknown; // to be casted by each plugin who consume it

export async function loadPlugins(
  tangramApi: TangramApi,
  onProgress?: (progress: PluginProgress) => void
) {
  onProgress?.({ stage: "manifest" });
  const manifest = await fetch("/manifest.json").then(res => res.json());

  for (const [pluginName, meta] of Object.entries(manifest.plugins)) {
    const pluginMeta = meta as {
      main: string;
      style?: string;
      config?: PluginConfig;
    };

    onProgress?.({ stage: "plugin", pluginName });

    if (pluginMeta.style) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/plugins/${pluginName}/${pluginMeta.style}`;
      document.head.appendChild(link);
    }

    const entryPointUrl = `/plugins/${pluginName}/${pluginMeta.main}`;

    try {
      const pluginModule = await import(/* @vite-ignore */ entryPointUrl);
      if (pluginModule.install) {
        pluginModule.install(tangramApi, pluginMeta.config);
      }
    } catch (e) {
      console.error(`failed to load plugin "${pluginName}":`, e);
    }
  }

  onProgress?.({ stage: "done" });
}
