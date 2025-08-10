Frontend plugins are standalone NPM packages that add new widgets and functionality to the `tangram` web interface. This system is designed for modularity, allowing you to build and share custom UI components.

# 1. Project Structure

A frontend plugin is a standard TypeScript/Vue project that produces a library build.

```text
my-tangram-frontend-plugin/
├── package.json
├── vite.config.ts
└── src/
    ├── MyWidget.vue
    └── index.ts
```

# 2. Plugin Entry Point (`index.ts`)

The `main` file specified in your `package.json` must export an `install` function. This function is the plugin's entry point and receives the `TangramApi` object, which provides methods for interacting with the core application.

```typescript title="src/index.ts"
import type { TangramApi } from "@open-aviation/tangram/types";
import MyWidget from "./MyWidget.vue";

export function install(api: TangramApi) {
  // use the API to register a new widget component
  api.registerWidget("my-widget", MyWidget);
}
```

# 3. `vite` configuration

To simplify the build process, `tangram` provides a shared Vite plugin. This handles the complex configuration needed to build your plugin as a library and generate a `plugin.json` manifest.

```typescript title="vite.config.ts"
import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram/vite-plugin";

export default defineConfig({
  plugins: [tangramPlugin()],
});
```

This standardized build produces a `dist-frontend` directory containing your compiled JavaScript and the manifest file, which `tangram` uses to load your plugin.

# 4. Building and using your plugin

First, build your frontend assets. If you are in the monorepo, `pnpm build` will handle this.

Next, install your Python package (which now includes the frontend assets). Finally, enable it in your [`tangram.toml`](../configuration.md):

```toml
[core]
plugins = ["my_tangram_plugin"] # assumes backend and frontend are in one package
```

When `tangram serve` runs, it will:
1.  Serve the static assets from your plugin's `dist-frontend` directory.
2.  Include your plugin in the `/manifest.json` endpoint.
3.  The core web app will fetch the manifest and dynamically load and install your plugin.

<!-- # Implement a frontend plugin

Frontend plugins are Vue.js components that can be dynamically loaded into the tangram web application. The common use case is to get data from the backend (REST API or Websocket) and display it in a custom way, such as on a map or in a table.

## Vue components

The core Vue components are currently located in the `src/components/` directory: plugins can be added to this directory (default fallback location) or in a custom directory, then the full path will be specified as an environment variable.

The usual way to import a component in a vue file is to import it like this:

```javascript
import MyPlugin from "./components/MyPlugin.vue";
```

then to include a node in the template:

```html
<MyPlugin />
```

A plugin component will be imported a bit differently, as it is usually not located in the `src/components/` directory. Instead, it will be imported dynamically based on the environment variable `TANGRAM_WEB_MYPLUGIN_PLUGIN`. The environment variable shall be defined in the `.env` file, and it should point to the full path of the plugin component file. Then the component should be declared in the `vite.config.js` file, which is responsible for loading the Vue components dynamically:

```javascript
plugins: [
  // ..., other settings
  dynamicComponentsPlugin({
    envPath: "../.env",
    fallbackDir: "./src/plugins/",
    availablePlugins: [
      "airportSearch",
      "systemInfo",
      "sensorsInfo",
      "cityPair",
      // list all your plugins here
      "myPlugin", // This is your custom plugin
    ],
  }),
];
```

Then you will be able to include the node in the template part of another component like this:

```html
<template>
  <plugin-myplugin />
</template>
```

!!! tip

    There is one use case where it is convenient to have a plugin in the default `src/components/` directory.

    In some cases, you would like to have several possible implementations for a functionality. This can be done in several Vue files, and you can switch the full path to the file in the `.env` file. If the environment variable is not defined, the plugin will be loaded from the default `src/components/` directory.

    | `TANGRAM_WEB_MYPLUGIN_PLUGIN`    | Resulting component path         |
    | -------------------------------- | -------------------------------- |
    | undefined                        | `src/plugins/MyPlugin.vue`       |
    | `/path/to/plugins/MyPlugin1.vue` | `/path/to/plugins/MyPlugin1.vue` |
    | `/path/to/plugins/MyPlugin2.vue` | `/path/to/plugins/MyPlugin2.vue` |

Example usage:

- [Map data receivers](examples/sensors.md)

## Technical details

### Registration process

When Tangram initializes, the plugin system:

1. reads the list of available plugins
2. checks for environment variable overrides
3. imports components from the specified paths or fallbacks
4. registers the components with the Vue application

### Hot reloading

The plugin system monitors any change to the environment configuration and:

- Invalidates cached module definitions
- Reloads the plugin components
- Triggers a page refresh to show the updated components

### Implementation Details

The dynamic component system is implemented as a Vite plugin (`vite-plugin-dynamic-components.js`) that:

1. Creates a virtual module (`virtual:plugin-components`) at build time
2. Dynamically generates import statements based on environment configuration
3. Exports a `registerComponents` function that Vue uses during initialization
4. Watches for changes to the environment variables

Key functions in the implementation:

- `createEnvVarsMap()`: Collects environment variables with the `TANGRAM_WEB_` prefix
- `generateComponentName()`: Converts plugin names to kebab-case component names
- `load()`: Generates the dynamic import and registration code
- `configureServer()`: Sets up watchers for hot reloading

## Troubleshooting

If the component does not load or behaves unexpectedly, consider the following:

- Verify the environment variable path is correct and absolute
- Check console logs for fallback path messages
- Check the web console in process-compose for any errors during component loading
- Ensure the component is correctly registered in `vite.config.js`

If you see style conflicts or unexpected behavior:

- Use scoped styles to prevent CSS leaks
- Be aware of global styles that might affect your component

If the hot reloading does not work as expected:

- Verify the env file is being watched correctly
- Check for errors in the console during reload -->
