# Tangram Plugin System: Out-of-Tree Vue Components

Tangram's frontend architecture features a flexible plugin system that allows developers to create and deploy Vue components from independent projects. This "out-of-tree" approach enables the extension of Tangram's frontend capabilities without modifying the core codebase.

## Overview

The plugin system uses Vite's custom plugin capabilities to dynamically discover, load, and register Vue components at build time. This allows for a modular development approach where plugins can be developed and maintained separately from the main Tangram codebase.

## Key Features

- **Independent Development**: Build plugins in separate repositories
- **Dynamic Loading**: Components are loaded based on configuration
- **Environment-based Configuration**: Use environment variables to specify plugin paths
- **Fallback Mechanism**: Default components are used if custom ones aren't found
- **Hot Reloading**: Changes to plugin configuration trigger automatic reloads

## How It Works

### 1. Plugin Discovery

The system identifies available plugins through:

1. A predefined list of available plugins in the configuration
2. Environment variables that point to the location of custom implementations

Environment variables follow the pattern `TANGRAM_WEB_[PLUGIN_NAME]` and should contain the path to the Vue component file.

### 2. Component Naming Convention

For each plugin, a standardized component name is generated:

- Plugin name: `time_plugin`
- Generated component name: `plugin-time`
- Default fallback location: `/src/components/TimePlugin.vue`

### 3. Registration Process

When Tangram initializes, the plugin system:

1. Reads the list of available plugins
2. Checks for environment variable overrides
3. Imports components from the specified paths or fallbacks
4. Registers the components with the Vue application

### 4. Hot Reloading

The plugin system monitors changes to the environment configuration and:
- Invalidates cached module definitions
- Reloads the plugin components
- Triggers a page refresh to show the updated components

## Creating a Custom Plugin

To create a custom plugin for Tangram:

1. **Create a New Project** or add to an existing project
2. **Build Your Vue Component**:
   - Match the interface of the component you're replacing
   - Ensure all required props and events are supported
3. **Configure the Environment**:
   - Set the appropriate environment variable to point to your component
   - Example: `TANGRAM_WEB_TIME_PLUGIN=/path/to/your/CustomTime.vue`

### Example: Custom Time Plugin

Here's an example of replacing the built-in Time component with a custom version:

1. Create your custom component:

```vue
<!-- plugins/status/web/components/Time.vue -->
<template>
  <div>
    <ul class="nav nav-tabs navbar-nav">
      <li class="nav-item clock">
        <span id="info_utc" v-html="info_utc"></span>Z |
        <span id="info_local" v-html="info_local"></span>
      </li>
      <span id="uptime" v-html="uptime"></span>
    </ul>
  </div>
</template>

<script>
import { useMapStore } from "../../../../web/src/store";

export default {
  data() {
    return {
      store: useMapStore(),
    };
  },
  computed: {
    info_utc() {
      return this.store.info_utc;
    },
    info_local() {
      return this.store.local_time;
    },
    uptime() {
      return this.store.uptime;
    },
  },
};
</script>

<style scoped>
#info_local {
  color: green; /* Custom styling */
}
</style>
```

2. Configure the environment:

Add to your `.env` file:
```
TANGRAM_WEB_TIME_PLUGIN=/path/to/plugins/status/web/components/Time.vue
```

## Plugin Configuration

The Vite plugin that handles dynamic components accepts these configuration options:

```javascript
dynamicComponentsPlugin({
  // Path to the .env file
  envPath: './.env',
  
  // Directory for fallback components
  fallbackDir: '/src/components/',
  
  // List of available plugins (without "_plugin" suffix)
  availablePlugins: ['time', 'status', 'map', 'table']
})
```

## Default Available Plugins

The Tangram frontend comes with several built-in plugins that can be replaced:

- **time_plugin**: Displays UTC and local time

## Implementation Details

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

Common issues when working with custom plugins:

1. **Component Not Loading**: 
   - Verify the environment variable path is correct and absolute
   - Check console logs for fallback path messages

2. **Store Connection Issues**:
   - Ensure you're importing the store from the correct location
   - Check that you're using the same store methods as the original component

3. **Styling Conflicts**:
   - Use scoped styles to prevent CSS leaks
   - Be aware of global styles that might affect your component

4. **Hot Reload Not Working**:
   - Verify the env file is being watched correctly
   - Check for errors in the console during reload

## Conclusion

The out-of-tree plugin system provides a powerful way to extend and customize the Tangram frontend. By allowing components to be developed and maintained independently, it promotes modularity and separation of concerns while enabling teams to adapt Tangram to their specific visualization needs.

This approach aligns with Tangram's progressive development philosophy, allowing teams to start with the default components and gradually replace them with custom implementations as their requirements evolve.