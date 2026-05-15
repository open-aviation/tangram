import { reactive } from "vue";
import type { Disposable, JsonSchema, PluginContext, TangramApi } from "./api";

type PluginProgressStage = "manifest" | "plugin" | "done";
type PluginProgress = {
  stage: PluginProgressStage;
  pluginName?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginConfig = Record<string, any>;

type PluginModule = {
  install?: (ctx: PluginContext, config?: PluginConfig) => unknown;
};

const loadedPlugins = new Map<string, Disposable>();

function createPluginHandle(
  tangramApi: TangramApi,
  pluginId: string
): Disposable & {
  readonly context: PluginContext;
} {
  const ownedDisposables = new Set<Disposable>();
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

  return {
    context: {
      id: pluginId,
      api: tangramApi,
      onDispose
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
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

  for (const [pluginName, meta] of Object.entries(tangramApi.manifest.plugins)) {
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

    if (!pluginMeta.main) continue;

    const entryPointUrl = `/plugins/${pluginName}/${pluginMeta.main}`;
    loadedPlugins.get(pluginName)?.dispose();
    loadedPlugins.delete(pluginName);

    const pluginHandle = createPluginHandle(tangramApi, pluginName);

    try {
      const pluginModule = (await import(
        /* @vite-ignore */ entryPointUrl
      )) as PluginModule;

      if (pluginModule.install) {
        await pluginModule.install(
          pluginHandle.context,
          tangramApi.settings[pluginName]?.values ?? pluginMeta.config
        );
      }

      loadedPlugins.set(pluginName, pluginHandle);
    } catch (e) {
      pluginHandle.dispose();
      console.error(`failed to load plugin "${pluginName}":`, e);
    }
  }

  onProgress?.({ stage: "done" });
}
