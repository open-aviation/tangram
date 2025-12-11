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

  for (const [pluginName, pluginManifest] of Object.entries(manifest.plugins)) {
    onProgress?.({ stage: "plugin", pluginName });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pm = pluginManifest as any;

    if (pm.style) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/plugins/${pluginName}/${pm.style}`;
      document.head.appendChild(link);
    }

    const entryPointUrl = `/plugins/${pluginName}/${pm.main}`;

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
