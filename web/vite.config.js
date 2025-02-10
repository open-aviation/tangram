import process from "process";
import fs from "fs";
import path from "path";

import { defineConfig, normalizePath } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/dist/vite";

let tangram_service = process.env.TANGRAM_SERVICE || "127.0.0.1:18000";

function getPluginEnvVars() {
  return Object.entries(process.env)
    .filter(([key]) => key.startsWith("TANGRAM_WEB_"))
    .map(([key, value]) => ({
      key: key.replace("TANGRAM_WEB_", "").toLowerCase(),
      path: value,
    }));
}

function generateComponentName(key) {
  // Convert something like 'TIME_PLUGIN' to 'plugin-time'
  return (
    "plugin-" + key.toLowerCase().replace("_plugin", "").replace(/_/g, "-")
  );
}

function dynamicComponentsPlugin() {
  const virtualModuleId = "virtual:plugin-components";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;

  return {
    name: "vite-plugin-dynamic-components",

    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },

    async load(id) {
      if (id === resolvedVirtualModuleId) {
        const imports = [];
        const registrations = [];

        const plugins = getPluginEnvVars();

        plugins.forEach(({ key, path: pluginPath }, index) => {
          const componentVarName = `Component${index}`;
          const absPath = path.resolve(pluginPath);
          const componentName = generateComponentName(key);

          if (fs.existsSync(absPath)) {
            // Use environment variable path
            imports.push(
              `import ${componentVarName} from '${normalizePath(absPath)}'`,
            );
          } else {
            // Fallback to src/components
            const fileName = path.basename(pluginPath);
            imports.push(
              `import ${componentVarName} from '/src/components/${fileName}'`,
            );
            console.warn(
              `Plugin path ${absPath} not found, falling back to /src/components/${fileName}`,
            );
          }

          registrations.push(
            `app.component('${componentName}', ${componentVarName})`,
          );
        });

        if (imports.length === 0) {
          return `
            export function registerComponents(app) {
              // No plugins found
              console.info('No TANGRAM_WEB_ plugins found in environment variables')
            }
          `;
        }

        return `
          ${imports.join("\n")}

          export function registerComponents(app) {
            ${registrations.join("\n")}
          }
        `;
      }
    },

    configureServer(server) {
      // Log available plugins during dev
      const plugins = getPluginEnvVars();
      if (plugins.length > 0) {
        console.info(
          "Found TANGRAM_WEB_ plugins:",
          plugins.map((p) => `\n  ${p.key} => ${p.path}`).join(""),
        );
      }
    },
  };
}

export default defineConfig({
  server: {
    proxy: {
      // string shorthand: http://localhost:5173/foo -> http://localhost:4567/foo
      // with options: http://localhost:5173/api/bar -> http://jsonplaceholder.typicode.com/bar
      "/data": `http://${tangram_service}`,
      "/token": `http://${tangram_service}`,
      // "^/plugins.*": {
      //   target: `https://${tangram_service}/plugins.*`,
      //   changeOrigin: true,
      // },
      "^/flight/.*": {
        target: `https://${tangram_service}/flight/.*`,
        changeOrigin: true,
      },
      // Proxying websockets or socket.io: ws://localhost:5173/socket.io -> ws://localhost:5174/socket.io
      // Exercise caution using `rewriteWsOrigin` as it can leave the proxying open to CSRF attacks.
      "/websocket": {
        target: `ws://${tangram_service}/websocket?userToken=joining-token&vsn=2.0.0`,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    AutoImport({ imports: ["vue", "vue-router"] }), // vue、vue-router imported automatically
    dynamicComponentsPlugin(),
  ],
});
