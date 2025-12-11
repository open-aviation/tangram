# System Plugin

The `tangram_system` plugin provides a background service that monitors and broadcasts server metrics like CPU load, RAM usage, and uptime. These metrics are displayed in the frontend UI.

## How It Works

1. The plugin's `pyproject.toml` registers its `plugin` object via the [`tangram_core.plugins` entry point](./backend.md).
2. This `plugin` object uses the [`@plugin.register_service()`][tangram_core.Plugin.register_service] decorator to mark the `run_system` function as a background service.
3. When `tangram serve` starts, the core framework discovers and runs the `run_system` service.
4. It publishes these metrics as JSON payloads to the `to:system:update-node` Redis channel.
5. The core `tangram` frontend is subscribed to the `system` WebSocket channel. The `channel` service forwards these Redis messages to the UI, where components like `SystemInfo.vue` update to display the live data.

## Redis Events

| Direction | Channel                 | Event/Command | Payload                                                 |
| :-------- | :---------------------- | :------------ | :------------------------------------------------------ |
| Output    | `to:system:update-node` | `PUBLISH`     | `{"el": "uptime" \| "cpu_load" \| ..., "value": "..."}` |
