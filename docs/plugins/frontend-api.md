# Frontend API

When building the frontend for external tangram plugins, you may find helpers in the published `@open-aviation/tangram-core` useful:

- `@open-aviation/tangram-core/api`: [plugin context and API](plugin-context)
- `@open-aviation/tangram-core/components`: [reusable Vue components for consistent styling](#shared-components)
- `@open-aviation/tangram-core/vite-plugin`: [the frontend building and asset packaging itself](./frontend.md#vite-configuration)

Some lower-level helpers may be useful too, but they are less stable and may change at any point:

- `@open-aviation/tangram-core/trajectory`: Utilities for any trajectory, such as segmentation, interpolation and deck.gl rendering utilities 
- `@open-aviation/tangram-core/utils`: icons, colour conversation, parsing, time formatting, etc.
- `@open-aviation/tangram-core/keyboard`: Vim list navigation

## Plugin context

Every frontend entry module exports `install(ctx, config?)`. The loader awaits the returned promise and disposes registered resources if installation fails.

The `ctx.api` allows you to access the tangram API, including the UI, map, search, import workspace, time selection, realtime, trajectory and the event bus. For example, to register your own widget:

```ts
import type { PluginContext } from "@open-aviation/tangram-core/api";
import MyWidget from "./MyWidget.vue";

export function install(ctx: PluginContext) {
  ctx.api.ui.registerWidget("my-widget", "SideBar", MyWidget, {
    pluginId: ctx.id,  // (1)!
    title: "My widget",
    props: { mode: "compact" }  // (2)!
  });
}
```

1. By passing the plugin identifier, the core understands to cleanup the resources on unloading automatically. Otherwise, if you wish to own an active resource such as a subscription, watcher, timer or DOM listener, use the `ctx.onDispose(disposable)` API.
2. Widget `props` are fixed for that registration. You can pass reactive objects too!

### Frontend configuration

A backend [`Plugin`][tangram_core.Plugin] may define the shape of the configuration with [`frontend_config_class`][tangram_core.Plugin.frontend_config_class]. In cases where you need to omit secrets, or derive browser-only values, pass in the [`into_frontend_config_function`][tangram_core.Plugin.into_frontend_config_function], or annotate fields with the [`FrontendMutable`][tangram_core.config.FrontendMutable] sentinel. 

Tangram then serialises that into the manifest, converting it into a **reactive object** and passing that into the second argument to `install`. When the user changes the user settings in the UI, your code should react to those changes.

```ts
interface MyFrontendConfig {
  enabled: boolean;
}

export function install(ctx: PluginContext, config?: MyFrontendConfig) {
  // `config` is present only when the backend plugin declares frontend config.
}
```

!!! warning

    Note that settings are currently ephermal, and will be reset to the original state when you refresh the browser! Tangram currently does not have the notion of "users", so a future plugin-scoped SQLite database that implements user authentication is planned.

## Shared Components

To make styles consistent, we provide some customisable Vue components:

```ts
import {
  ColorPicker,
  FileDropTarget,
  HighlightText,  // highlights case-insensitive matches of `query`, for use in search bars
  HoverLabel, // label with an optional native-tooltip description
  IconButton,
  SvgIcon,
} from "@open-aviation/tangram-core/components";
```

These components are opinionated and may change over time.

## Icons

Tangram uses Material Symbols Rounded SVGs. A small set of it can be found in `ICON_PATHS`, but you can also pass in your own SVG path in `SvgIcon`.

```vue
<script setup lang="ts">
import { IconButton, SvgIcon } from "@open-aviation/tangram-core/components";
import { ICON_PATHS } from "@open-aviation/tangram-core/utils";
</script>

<template>
  <IconButton title="Delete" danger>
    <SvgIcon :path="ICON_PATHS.delete" />
  </IconButton>
</template>
```

## Theme tokens

Plugin CSS should use Tangram's theme variables instead of assuming light or dark mode:

- `--t-bg`: Primary background
- `--t-fg`: Primary foreground
- `--t-surface`: Raised or grouped surface
- `--t-border`: Borders and separators
- `--t-hover`: Hover and active background
- `--t-accent1`, `--t-accent1-fg`: Primary accent and text on it
- `--t-accent2`, `--t-accent2-fg`: Secondary accent and text on it
- `--t-muted`: Secondary text and icons
- `--t-error`: Destructive and error states

For example:

```css
.panel {
  color: var(--t-fg);
  background: var(--t-surface);
  border: 1px solid var(--t-border);
}
```

These variables may change when the user updates their theme, so make sure to watch for changes!

