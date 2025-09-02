# Configuration

!!! warning
    The new configuration and plugin system is under active development. APIs and configuration schemas may change.

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

[server]
# main FastAPI web server, which serves the
# frontend application and plugin API routes.
host = "127.0.0.1"
port = 8000

[channel]
# integrated real-time WebSocket service.
host = "127.0.0.1"
port = 2347
# a secret key used to sign JSON Web Tokens (JWTs) for authenticating
# WebSocket connections. Change this to a strong, unique secret.
jwt_secret = "a-better-secret-than-this"

[plugins.tangram_jet1090]
# plugin-specific configuration is defined in its own table,
# following the pattern `[plugins.<plugin_package_name>]`.
# The structure of this table is defined by the plugin itself.
jet1090_channel = "jet1090"
history_expire = 20
```

<!-- Most of the configuration for the tangram platform will be done through **environment variables** and **configuration files**.

These include:

- the `.env` file for environment variables;
- the `web_legacy/vite.config.js` file for the web application build configuration;
- the `config_jet1090.toml` file for the [**`jet1090` configuration**](https://mode-s.org/jet1090/config/) relative to data sources.

## Environment variables

The `.env` file contains environment variables that configure the behaviour of the tangram platform. The file will be parsed by all the tools of the tangram suite.

You can create this file from the template provided in the repository (`.env.example`)

- `LOG_DIR` is the directory where logs will be stored. It defaults to `/tmp/tangram`, but you can change it to any directory you prefer.
- The installation scripts should be aware of the `HTTP_PROXY` and `HTTPS_PROXY` environment variables, which are used to configure the proxy settings for the tools that require internet access.

- `JET1090_CONFIG` is the path to the `jet1090` configuration file. It defaults to `config_jet1090.toml`, but you can change it to any file you prefer.
- `JET1090_URL` is the URL where the `jet1090` service will be available. It defaults to `http://jet1090:8080`, but you can change it to any URL you prefer.
- `REDIS_URL` is the URL where the Redis service will be available. It defaults to `redis://redis:6379`, but you can change it to any URL you prefer.

!!! warning

    - `localhost` refers to the current machine. When running containers, this will refer to the container itself;
    - `redis` and `jet1090` are the names of containers and should be automatically translated into the proper IP addresses;
    - if you want to **access the host machine from within a container**, you can use `host.containers.internal` to refer to the host machine's IP address.

The following services are run by default inside the tangram container:

- `TANGRAM_SERVICE` is the URL where the tangram service will be available. It defaults to `http://127.0.0.1:2346` (inside the container), but you can change it to any URL you prefer.
- `CHANNEL_SERVICE` is the URL where the channel service will be available. It defaults to `http://127.0.0.1:2347` (inside the container), but you can change it to any URL you prefer.

## Web interface configuration

All the environment variables starting with `VITE_` are used to configure the web application build process. These variables are used by Vite, the build tool used for the web application.

They **must be prefixed with `VITE_`** to be accessible in the web application code.

- `VITE_TANGRAM_MAP_URL` is the URL of the map tile server.
  It defaults to `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`, but you can change it to any tile server URL you prefer.
- `VITE_LEAFLET_CENTER_LAT` is the latitude of the center of the Leaflet map. It defaults to `48`, but you can change it to any latitude you prefer.
- `VITE_LEAFLET_CENTER_LON` is the longitude of the center of the Leaflet map. It defaults to `7`, but you can change it to any latitude you prefer.
- `VITE_LEAFLET_ZOOM` is the default zoom level for the Leaflet map. It defaults to `6`, but you can change it to any zoom level you prefer.

## Plugin configuration

The paths for Vue files corresponding to plugins are also set in the `.env` file: they must follow the pattern `TANGRAM_WEB_<component>_PATH`, e.g. `TANGRAM_WEB_AWESOMEPLUGIN_PATH`. These paths can be customized as needed and edited in real time without rebuilding the web application. The web application will automatically pick up changes to these paths.

The plugin components are expected to be in the `web_legacy/src/components/` directory (defined as `fallbackDir`), but you can override this path to point to any other directory containing Vue components.

The plugins must be declared in the `vite.config.js` file, which is used to build the web application. You must also list `availablePlugins` that will be used to build the web application. The plugin component names must be the same as the names of the Vue files, without the `.vue` extension. Capitalization should be consistent with the file name.

```javascript
plugins: [
    // (abridged)
    dynamicComponentsPlugin({
      envPath: "../.env",
      fallbackDir: "/src/components/",
      availablePlugins: ["awesomePlugin", "<component>"],
    }),
  ],
```

## Proxy new web services

Vite can also be configured to proxy requests to new web services. This is useful for integrating additional services into the tangram platform without modifying the existing codebase.
To add a new service, you can modify the `vite.config.js` file to include a new proxy configuration. For example, to proxy requests to a service running on `http://localhost:3000`, you can add the following configuration:

```javascript
proxy: {
  '/newservice': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    secure: false,
    rewrite: (path) => path.replace(/^\/new-service/, ''),
  },
},
``` -->
