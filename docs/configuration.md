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

[plugins.tangram_jet1090]  # (3)!
# plugin-specific configuration is defined in its own table,
# following the pattern `[plugins.<plugin_package_name>]`.
# The structure of this table is defined by the plugin itself.
jet1090_channel = "jet1090"
state_vector_expire = 20
```

1. See [`tangram_core.config.CoreConfig`][].
2. See [`tangram_core.config.ServerConfig`][]
3. See [`tangram_core.config.ChannelConfig`][]
