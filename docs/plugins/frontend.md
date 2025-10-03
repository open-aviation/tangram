# Frontend

Frontend plugins are standalone NPM packages that add new widgets and functionality to the `tangram` web interface. This system is designed for modularity, allowing you to build and share custom UI components.

## 1. Project Structure

A frontend plugin is a standard TypeScript/Vue project that produces a library build.

```text
my-tangram-frontend-plugin/
├── package.json
├── vite.config.ts
└── src/
    ├── MyWidget.vue
    └── index.ts
```

## 2. Plugin Entry Point (`index.ts`)

The `main` file specified in your `package.json` must export an `install` function. This function is the plugin's entry point and receives the `TangramApi` object, which provides methods for interacting with the core application.

<!-- TODO(abrah): eliminate some of these when we use mkdocstrings -->
```typescript title="src/index.ts"
import type { TangramApi } from "@open-aviation/tangram/types";
import MyWidget from "./MyWidget.vue";

export function install(api: TangramApi) {
  // use the API to register a new widget component.
  // the first argument is a unique ID for your widget.
  // the second is the Vue component itself.
  api.registerWidget("my-widget", MyWidget);
}
```

The `TangramApi` provides two main functions:

- `registerWidget(id: string, component: Component)`: Makes your component available to the core UI.
- `getVueApp(): App`: Provides access to the core Vue application instance for advanced use cases.

## 3. `vite` configuration

To simplify the build process, `tangram` provides a shared Vite plugin. This handles the complex configuration needed to build your plugin as a library and generate a `plugin.json` manifest file.

```typescript title="vite.config.ts"
import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram/vite-plugin";

export default defineConfig({
  plugins: [tangramPlugin()],
});
```

This standardized build produces a `dist-frontend` directory containing your compiled JavaScript and the manifest file. `tangram` uses this manifest to discover and load your plugin.

## 4. Building and using your plugin

First, build your frontend assets. If you are in the monorepo, `pnpm build` will handle this.

Next, ensure the generated `dist-frontend` directory is included in your Python package's wheel. This is typically done in `pyproject.toml`.

=== "hatchling"

    ```toml
    [tool.hatch.build.targets.wheel.force-include]
    "dist-frontend" = "my_plugin/dist-frontend"
    ```

=== "maturin"

    <!-- TODO: check this -->

Finally, install your Python package and enable it in your `tangram.toml`:

```toml
[core]
plugins = ["my_tangram_plugin"]
```

When `tangram serve` runs, it will:

1. Serve the static assets from your plugin's `dist-frontend` directory.
2. Include your plugin in the `/manifest.json` endpoint.
3. The core web app will fetch the manifest and dynamically load and install your plugin.

```mermaid
sequenceDiagram
    participant P as Plugin Module
    participant B as Browser
    participant S as Tangram Server

    B->>S: GET /manifest.json
    S-->>B: Respond with {"plugins": ["my_plugin"]}
    B->>S: GET /plugins/my_plugin/plugin.json
    S-->>B: Respond with {"main": "index.js"}
    B->>S: GET /plugins/my_plugin/index.js
    S-->>B: Serve plugin's JS entry point
    Note over B, P: Browser executes plugin code
    P->>B: install(tangramApi)
    Note over B: Plugin registers its widgets
