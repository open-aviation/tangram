import type { TangramApi } from "./api";

export async function loadPlugins(tangramApi: TangramApi) {
  const manifest = await fetch("/manifest.json").then(res => res.json());

  for (const pluginName of manifest.plugins) {
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
}
