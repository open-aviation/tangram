import { reactive } from "vue";
import type { Disposable, JsonSchema, PluginContext, TangramApi } from "./api";

type PluginProgressStage = "manifest" | "plugin" | "done";
type PluginProgress = {
  stage: PluginProgressStage;
  pluginId?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginConfig = Record<string, any>;

type PluginModule = {
  install?: (ctx: PluginContext, config?: PluginConfig) => unknown;
};

const PLUGIN_ASSET_DIR = "plugin-assets";
const loadedPlugins = new Map<string, Disposable>();

export function pluginAssetUrl(pluginId: string, fileName: string): string {
  const segments = fileName.split("/");
  if (
    !fileName ||
    fileName.startsWith("/") ||
    fileName.includes("\\") ||
    fileName.includes("?") ||
    fileName.includes("#") ||
    segments.some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`invalid plugin asset filename: ${fileName}`);
  }
  return `/plugins/${pluginId}/${PLUGIN_ASSET_DIR}/${segments
    .map(encodeURIComponent)
    .join("/")}`;
}

function createPluginHandle(
  tangramApi: TangramApi,
  pluginId: string
): Disposable & {
  readonly context: PluginContext;
} {
  const ownedDisposables = new Set<Disposable>();
  const controller = new AbortController();
  let disposed = false;

  const onDispose = <T extends Disposable>(disposable: T): T => {
    if (disposed) {
      disposable.dispose();
      return disposable;
    }

    let removed = false;
    const tracked: T = {
      ...disposable,
      dispose: () => {
        if (removed) return;
        removed = true;
        ownedDisposables.delete(tracked);
        disposable.dispose();
      }
    };

    ownedDisposables.add(tracked);
    return tracked;
  };

  const assetUrl = (fileName: string) => pluginAssetUrl(pluginId, fileName);
  const importModule = <T>(fileName: string) =>
    import(/* @vite-ignore */ assetUrl(fileName)) as Promise<T>;

  return {
    context: {
      id: pluginId,
      api: tangramApi,
      signal: controller.signal,
      assetUrl,
      importModule,
      onDispose
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const disposable of [...ownedDisposables].reverse()) {
        disposable.dispose();
      }
      ownedDisposables.clear();
      tangramApi.teardownPlugin(pluginId);
    }
  };
}

export async function loadPlugins(
  tangramApi: TangramApi,
  onProgress?: (progress: PluginProgress) => void
) {
  onProgress?.({ stage: "manifest" });

  // we want deterministic lifecycle and map ordering but we dont have a good
  // parallel loading solution yet so we use sequential
  for (const [pluginId, meta] of Object.entries(tangramApi.manifest.plugins)) {
    const pluginMeta = meta as {
      main?: string;
      style?: string;
      config?: PluginConfig;
      config_json_schema?: JsonSchema;
    };

    onProgress?.({ stage: "plugin", pluginId });

    loadedPlugins.get(pluginId)?.dispose();
    loadedPlugins.delete(pluginId);
    const pluginHandle = createPluginHandle(tangramApi, pluginId);

    try {
      let installConfig = pluginMeta.config;

      // install() may await network-backed dependencies, so settings and styles
      // are handle-owned
      if (pluginMeta.config) {
        const settings = {
          values: reactive({ ...pluginMeta.config }),
          schema: pluginMeta.config_json_schema || {},
          errors: reactive({})
        };
        tangramApi.settings[pluginId] = settings;
        installConfig = settings.values;
        pluginHandle.context.onDispose({
          dispose: () => delete tangramApi.settings[pluginId]
        });
      }

      if (pluginMeta.style) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/plugins/${pluginId}/${pluginMeta.style}`;
        document.head.appendChild(link);
        // style loading itself is not awaited; ownership only guarantees cleanup
        pluginHandle.context.onDispose({ dispose: () => link.remove() });
      }

      if (pluginMeta.main) {
        const entryPointUrl = `/plugins/${pluginId}/${pluginMeta.main}`;
        const pluginModule = (await import(
          /* @vite-ignore */ entryPointUrl
        )) as PluginModule;

        if (pluginModule.install) {
          await pluginModule.install(pluginHandle.context, installConfig);
        }
      }

      loadedPlugins.set(pluginId, pluginHandle);
    } catch (e) {
      pluginHandle.dispose();
      console.error(`failed to load plugin "${pluginId}":`, e);
    }
  }

  onProgress?.({ stage: "done" });
}
