# System Plugin

The `tangram_system` plugin provides a background service that monitors and broadcasts server metrics like CPU load, RAM usage, and uptime. These metrics are displayed in the frontend UI.

## How It Works

1. The plugin's `pyproject.toml` registers the `server_events` function under the `tangram.plugins` entry point.
2. When `tangram serve` starts, it calls the `register_plugin` function. This function creates an `asyncio.Task` to run the `server_events` coroutine.
3. The `server_events` task runs in a continuous loop. Every second, it gathers system metrics using the `psutil` library.
4. It publishes these metrics as JSON payloads to the `to:system:update-node` Redis channel.
5. The core `tangram` frontend is subscribed to the `system` WebSocket channel. The `channel` service forwards these Redis messages to the UI, where components like `SystemInfo.vue` update to display the live data.