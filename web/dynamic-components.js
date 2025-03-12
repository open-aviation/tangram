import { normalizePath } from "vite";
import path from "path";
import fs from "fs";
import process from "process";
import dotenv from "dotenv";

function loadCustomEnv(envPath) {
  try {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
    console.log("Loaded environment variables from", envPath);
  } catch (err) {
    console.error("Error loading .env file:", err);
  }
}

function createEnvVarsMap() {
  const envMap = new Map();
  Object.entries(process.env)
    .filter(([key]) => key.startsWith("TANGRAM_WEB_"))
    .forEach(([key, value]) => {
      const pluginKey = key.replace("TANGRAM_WEB_", "").toLowerCase();
      envMap.set(pluginKey, value);
    });
  return envMap;
}

function generateComponentName(pluginName) {
  return "plugin-" + pluginName.toLowerCase().replace("_plugin", "").replace(/_/g, "-");
}

export default function dynamicComponentsPlugin(options = {}) {
  const virtualModuleId = "virtual:plugin-components";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const customEnvPath = options.envPath ? path.resolve(options.envPath) : null;
  const fallbackDir = options.fallbackDir ?? "/src/components/";
  const availablePlugins = (options.availablePlugins ?? []).map((el) => `${el}_plugin`);

  console.log("Available plugins:", availablePlugins);

  return {
    name: "vite-plugin-dynamic-components",

    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },

    async load(id) {
      if (id === resolvedVirtualModuleId) {
        // Reload env file before processing
        if (customEnvPath) {
          loadCustomEnv(customEnvPath);
        }

        const imports = [];
        const registrations = [];
        const envVarsMap = createEnvVarsMap();

        console.log(availablePlugins);
        // Process each available plugin
        availablePlugins.forEach((pluginName, index) => {
          const componentVarName = `Component${index}`;
          const componentName = generateComponentName(pluginName);

          // Check if we have an environment variable path
          const envPath = envVarsMap.get(pluginName.toLowerCase());

          if (envPath) {
            // Try to use the environment variable path
            const absPath = path.resolve(envPath);
            if (fs.existsSync(absPath)) {
              imports.push(`import ${componentVarName} from '${normalizePath(absPath)}'`);
              console.log(`Using env path for ${pluginName}: ${absPath}`);
            } else {
              // Fallback if env path doesn't exist
              const fileName = path.basename(envPath);
              const fallbackPath = `${fallbackDir}${fileName}`;
              imports.push(`import ${componentVarName} from '${fallbackPath}'`);
              console.warn(`Env path ${absPath} not found for ${pluginName}, falling back to ${fallbackPath}`);
            }
          } else {
            // No env var, use default fallback path, convert time_plugin to Time
            const fileName =
              pluginName
                .split("_")
                .slice(0, 1)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join("") + ".vue";
            const fallbackPath = `${fallbackDir}${fileName}`;
            imports.push(`import ${componentVarName} from '${fallbackPath}'`);
            console.log(`No env path for ${pluginName}, using fallback: ${fallbackPath}`);
          }

          registrations.push(`app.component('${componentName}', ${componentVarName})`);
        });

        if (imports.length === 0) {
          return `
            export function registerComponents(app) {
              console.info('No plugins to register')
            }
          `;
        }

        let result = `
          ${imports.join("\n")}

          export function registerComponents(app) {
            ${registrations.join("\n")}
          }
        `;
        console.log("the result: \n", result);
        return result;
      }
    },

    configureServer(server) {
      // Initial env load
      if (customEnvPath) {
        loadCustomEnv(customEnvPath);

        // Watch for changes
        server.watcher.add(customEnvPath);
        server.watcher.on("change", (file) => {
          if (file === customEnvPath) {
            // Clear old env vars
            Object.keys(process.env).forEach((key) => {
              if (key.startsWith("TANGRAM_WEB_")) {
                delete process.env[key];
              }
            });

            // Load new env vars
            loadCustomEnv(customEnvPath);

            // Reload virtual module
            const moduleId = resolvedVirtualModuleId;
            const module = server.moduleGraph.getModuleById(moduleId);
            if (module) {
              server.moduleGraph.invalidateModule(module);
              console.log("Invalidated plugin components module");
            }

            // Force reload all clients
            server.ws.send({ type: "full-reload" });

            // Log changes
            const envVarsMap = createEnvVarsMap();
            console.log(
              "Updated environment mappings:",
              Array.from(envVarsMap.entries())
                .map(([key, value]) => `\n  ${key} => ${value}`)
                .join(""),
            );
          }
        });
      }
    },
  };
}
