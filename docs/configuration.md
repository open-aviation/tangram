# Configuration

`tangram` is configured through a single `tangram.toml` file. This provides a centralized and clear way to manage the entire platform, from core services to plugins.

## Example `tangram.toml`

```toml
[core]
# URL for the Redis instance used for pub/sub messaging.
redis_url = "redis://localhost:6379"

# a list of installed plugin packages to activate.
# tangram will look for entry points provided by these packages.
plugins = [
    "tangram_system",
    "tangram_jet1090",
    "my_awesome_package"
]

[server]  # (1)!
# main FastAPI web server, which serves the
# frontend application and plugin API routes.
host = "127.0.0.1"
port = 2346

[channel]  # (2)!
# integrated real-time WebSocket service.
host = "127.0.0.1"
port = 2347
# (optional) the public-facing base URL for the channel service, e.g., "https://tangram.example.com".
# use this when running behind a reverse proxy.
# public_url = "http://localhost:2347"
# a secret key used to sign JSON Web Tokens (JWTs) for authenticating
# WebSocket connections. Change this to a strong, unique secret.
jwt_secret = "a-better-secret-than-this"

[map]
# The basemap style can be a URL, a path to a local JSON file (relative to this config or absolute),
# or the id of a style defined in [[map.styles]].
style = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
# style = "./my-custom-style.json"
# style = "dark-matter"

# You can define multiple map styles available to the application.
[[map.styles]]
name = "Dark Matter"
id = "dark-matter"
version = 8
sources = { openmaptiles = { type = "vector", url = "https://d17gef4m69t9r4.cloudfront.net/planet.json" } }
sprite = "https://openmaptiles.github.io/dark-matter-gl-style/sprite"
glyphs = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf"
# ... layers ...
```

1. See [`tangram_core.config.CoreConfig`][].
2. See [`tangram_core.config.ServerConfig`][]
3. See [`tangram_core.config.ChannelConfig`][]

## Plugin Configuration

Plugin-specific configuration is defined in its own table, following the pattern `[plugins.<plugin_package_name>]`.

For details on each plugin's available settings, refer to their respective documentation:

- [`tangram_jet1090`](plugins/jet1090.md#configuration)
- [`tangram_ship162`](plugins/ship162.md#configuration)
- [`tangram_history`](plugins/history.md#configuration)
- [`tangram_explore`](plugins/explore.md#configuration)
- [`tangram_system`](plugins/system.md#configuration)
- [`tangram_airports`](plugins/airports.md#configuration)
