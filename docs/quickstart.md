Get tangram running in under five minutes.

## 1. Install the `tangram` core

=== "uv"

    ```sh
    uv tool install tangram-py
    ```

=== "pip"

    ```sh
    python3 -m virtualenv .venv
    . .venv/bin/activate
    pip install tangram-py
    ```

## 2. Configuration

Create a `tangram.toml` file to control the application. This is where you define which plugins are active.

```toml
[core]
redis_url = "redis://127.0.0.1:6379"
plugins = []

[server]
host = "127.0.0.1"
port = 8000

[channel]
host = "127.0.0.1"
port = 2347
jwt_secret = "a-very-insecure-secret-key-pls-change"
jwt_expiration_secs = 315360000
```

## 3. Running `tangram`

`tangram` uses Redis for messaging. If you do not have it, install [podman](https://podman.io/docs/installation) or [Docker](https://docs.docker.com/engine/install/) and run:

```shell
podman run -d --rm -p 6379:6379 --name redis redis:latest
# to verify connection:
podman container exec -it redis redis-cli ping
# PONG
```

To start tangram, run:

```shell
tangram serve --config /path/to/your/tangram.toml
```

Open your browser and navigate to <http://localhost:8000> to access the web interface.

![web interface](./screenshot/tangram_screenshot_nl.png)
<!-- todo: update -->

## 4. (Optional) Installing plugins

Plugins are standalone Python packages that extend the core.

For example, to install the `tangram_system` plugin:

=== "uv"

    ```sh
    uv tool install --with tangram_system tangram
    ```

=== "pip"

    ```sh
    # assuming tangram is already installed
    pip install tangram_system
    ```