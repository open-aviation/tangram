- **For Users:** To install and run `tangram` with official plugins, [start here &raquo;](#user-quickstart)
- **For Developers:** To contribute to the `tangram` core project, [set up the monorepo &raquo;](#developer-quickstart)
- **For Plugin Authors:** To build your own extensions for `tangram`, read the [plugin development guide &raquo;](./plugins/backend.md)

---

## User Quickstart

### Prerequisites

Ensure you have the following installed:

- redis 8 or above (via [podman](https://podman.io/docs/installation)/[docker](https://docs.docker.com/engine/install/) or system-installed version)
- Python 3.10 or above

### 1. Install the `tangram` core

=== "uv"

    ```sh
    uv tool install tangram_core
    ```

=== "pip"

    ```sh
    python3 -m venv .venv
    source .venv/bin/activate
    pip install tangram_core
    ```

For end users, the only supported installation method is from a package index (like PyPI) that hosts pre-built binary wheels. For developers wanting to use the latest git version, refer to the developer guide [below](#developer-quickstart).

### 2. Configuration

Create a `tangram.toml` file to control the application. This is where you define which plugins are active.

```toml
[core]
redis_url = "redis://127.0.0.1:6379"
plugins = []

[server]
host = "127.0.0.1"
port = 2346

[channel]
host = "127.0.0.1"
port = 2347
jwt_secret = "a-better-secret-than-this"
jwt_expiration_secs = 315360000
```

### 3. Running `tangram`

`tangram` uses Redis for messaging. The easiest way to run one is with a container.
Install [podman](https://podman.io/docs/installation) or [docker](https://docs.docker.com/engine/install/) and run:

```shell
podman run -d --rm -p 6379:6379 --name redis redis:latest
```

To start tangram, run:

```shell
tangram serve --config /path/to/your/tangram.toml
```

Open your browser and navigate to <http://localhost:2346> to access the web interface.

### 4. Adding functionality with plugins

The core `tangram` application provides the shell. All features are added by installing and enabling plugins.

### *Example 1: add system monitoring*

The `tangram_system` plugin adds a widget to the UI that displays server metrics like CPU and memory usage. It is a pure-Python package with no external services.

#### 1. Install the plugin package

=== "uv"

    ```sh
    uv tool install --with tangram_system tangram
    ```

=== "pip"

    ```sh
    # assuming you have an active virtual environment with tangram_core installed
    pip install tangram_system
    ```

#### 2. Enable the plugin in your `tangram.toml`

```toml hl_lines="3"
[core]
redis_url = "redis://127.0.0.1:6379"
plugins = ["tangram_system"]

[server]
# ...
```

#### 3. Restart the server

Stop the running `tangram serve` process (<kbd>Ctrl</kbd> + <kbd>C</kbd>) and start it again. The web interface will now include the system monitoring widget.

### *Example 2: add live aircraft data*

To display live flight data, you need the `tangram_jet1090` plugin. This plugin is more advanced, as it requires an external data source.

#### 1. Run the `jet1090` service

The plugin needs a running `jet1090` instance to receive Mode S/ADS-B data. The easiest way to run one is with a container.

```shell
# connects to a public feed.
podman run -d --rm --name jet1090 \
--network=host \
ghcr.io/xoolive/jet1090:latest \
jet1090 --redis-url "redis://127.0.0.1:6379" "ws://feedme.mode-s.org:9876/40128@EHRD"
```
!!! tip
    The `jet1090` container is a dependency of the *plugin*, not the `tangram` core. You can run it on any machine as long as it can connect to your Redis instance.

#### 2. Install and enable the plugin

Just like before, install the package and add it to your `tangram.toml`.

=== "uv"

    ```sh
    uv tool install --with tangram_system --with tangram_jet1090 tangram
    ```

=== "pip"

    ```sh
    # assuming you have an active virtual environment with tangram_core installed
    pip install tangram_jet1090
    ```

```toml hl_lines="5"
[core]
redis_url = "redis://127.0.0.1:6379"
plugins = [
    "tangram_system",
    "tangram_jet1090"
]
```

#### 3. Restart `tangram serve`

After restarting, your map should begin to populate with live aircraft data.

```mermaid
graph LR
    subgraph Your Machine
        direction LR
        J[jet1090 container] --> R[Redis]
        T[tangram process] --> R
    end
    subgraph Internet
        F[Public ADS-B Feed] --> J
    end

    B[Browser] --> T
```

## Developer Quickstart

This guide is for setting up a development environment for the `tangram` core and builtin plugins.
To extend `tangram`, start with the [**Backend Plugin Guide**](./plugins/backend.md) instead. This is the definitive resource for creating your own installable plugins with custom APIs and services.

### Prerequisites

Ensure you have the following installed:

- git
- redis 8 or above (via [podman](https://podman.io/docs/installation)/[docker](https://docs.docker.com/engine/install/) or system-installed version)
- Python 3.10 or above
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (not required, but highly recommended)
- [Rust](https://www.rust-lang.org/tools/install)
- [Node](https://nodejs.org/) and [pnpm](https://pnpm.io/)

To get things quickly installed:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://fnm.vercel.app/install | bash
fnm install --latest
corepack enable pnpm
```
<!-- TODO clarify what how exactly is the frontend installed - does it support HMR? -->

### Environment Setup

1. Clone the repository:

    ```sh
    git clone https://github.com/open-aviation/tangram.git
    cd tangram
    ```

2. Build the frontend

    ```sh
    pnpm i
    pnpm build
    ```

3. Install Python dependencies

    ```sh
    uv sync --all-packages --all-groups --all-extras
    ```

This installs the core application and all plugins in editable mode into a virtual environment, along with useful developer utilities.

Note that `uv sync` invokes the `maturin` build backend, which in turn passes `--release` to the Rust compiler.
This can cause builds to be very slow. **For the `tangram_history` plugin, it can take up to 10 minutes.**

To significantly cut down compile times at the cost of much larger binary size, you may want to use `uv sync --config-setting 'build-args=--profile=dev'` instead:

<!-- rg --files -uu packages | rg "so$" | xargs stat -c "%s %n" -->

|                        | release (default) | `profile=dev` |
| ---------------------- | ----------------- | ------------- |
| compile time (clean)   | 11m44s            | 1m51s         |
| `tangram` size         | 5.19M             | 116M          |
| `tangram_jet1090` size | 5.68M             | 128M          |
| `tangram_ship162` size | 3.80M             | 91M           |
| `tangram_history` size | 117M              | 949M          |

### Running in Development Mode

1. Ensure Redis (and any other services like `jet1090`) are running, as described in the user guide above.

2. Start the `tangram` server. This runs the FastAPI application, the `channel` service, and all enabled backend plugins.

    ```sh
    uv run tangram serve --config tangram.example.toml
    ```

The application will be available at `http://localhost:2346`.

!!! note "Frontend Development"
    Hot Module Replacement (HMR) for frontend plugins is not yet supported. To see changes to frontend components, you must re-run `pnpm build` and restart the `tangram serve` process.
    If you made changes to Rust code, you may need to re-run `uv` with the `--force-reinstall` or `--reinstall-package` flag.

To build the documentation:

```sh
uv run mkdocs serve
```

To format all Rust, Python and JS code:

```sh
just fmt
```
