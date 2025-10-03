import type { TangramApi } from "./api";

type PluginProgressStage = "manifest" | "plugin" | "done";
type PluginProgress = {
  stage: PluginProgressStage;
  pluginName?: string;
};

export async function loadPlugins(
  tangramApi: TangramApi,
  onProgress?: (progress: PluginProgress) => void
) {
  onProgress?.({ stage: "manifest" });
  const manifest = await fetch("/manifest.json").then(res => res.json());

  for (const pluginName of manifest.plugins) {
    onProgress?.({ stage: "plugin", pluginName });
    const pluginManifestUrl = `/plugins/${pluginName}/plugin.json`;
    const pluginManifest = await fetch(pluginManifestUrl).then(res => res.json());

    if (pluginManifest.style) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/plugins/${pluginName}/${pluginManifest.style}`;
      document.head.appendChild(link);
    }

    const entryPointUrl = `/plugins/${pluginName}/${pluginManifest.main}`;

    try {
      const pluginModule = await import(/* @vite-ignore */ entryPointUrl);
      if (pluginModule.install) {
        pluginModule.install(tangramApi);
      }
    } catch (e) {
      console.error(`failed to load plugin "${pluginName}":`, e);
    }
  }

  onProgress?.({ stage: "done" });
}
