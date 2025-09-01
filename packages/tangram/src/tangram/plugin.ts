import type { TangramApi } from "./types";

export async function loadPlugins(tangramApi: TangramApi) {
  const manifest = await fetch("/manifest.json").then(res => res.json());

  for (const pluginName of manifest.plugins) {
    const pluginManifestUrl = `/plugins/${pluginName}/plugin.json`;
    const pluginManifest = await fetch(pluginManifestUrl).then(res =>
      res.json()
    );
    const entryPointUrl = `/plugins/${pluginName}/${pluginManifest.main}`;

    try {
      const pluginModule = await import(/* @vite-ignore */ entryPointUrl);
      if (pluginModule.install) {
        pluginModule.install(tangramApi);
      }
    } catch (e) {
      console.error(`Failed to load plugin "${pluginName}":`, e);
    }
  }
}
