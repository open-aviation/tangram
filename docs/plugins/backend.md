Backend plugins are the standard way to add new server-side capabilities to `tangram`. They are self-contained Python packages that `tangram` discovers and loads at runtime, allowing for clean separation from the core framework.

This guide walks you through creating a backend plugin.

## 1. Project Structure

A backend plugin is a standard Python package.

```text
my-tangram-plugin/
├── pyproject.toml
└── src/
    └── my_plugin/
        └── __init__.py
```

## 2. The `pyproject.toml` and Entry Points

Your `pyproject.toml` tells the Python ecosystem that your package is a `tangram` plugin by defining **entry points**:

```toml title="pyproject.toml"
[project]
name = "my-tangram-plugin"
version = "0.1.0"
dependencies = [
    "tangram>=0.2.0"
]

# this section makes your plugin discoverable by the core
[project.entry-points."tangram.plugins"]
my_plugin = "my_plugin:plugin"
```

## 3. The Plugin Code

### Adding API Routes

Define a FastAPI `APIRouter` and pass it to the `Plugin` constructor.

```python title="src/my_plugin/__init__.py"
from fastapi import APIRouter
import tangram

router = APIRouter(prefix="/my-plugin")

@router.get("/")
async def my_endpoint():
    return {"message": "Hello from my custom plugin!"}

plugin = tangram.Plugin(routers=[router])

# ... service code below
```


### Adding a Background Service

Use the [`tangram.Plugin.register_service`][] decorator on an async function. `tangram` will start it in the background.

```python title="src/my_plugin/__init__.py"
# ... api code above

@plugin.register_service()
async def run_service(config: tangram.Config):
    """This function is run as a background service on a separate thread."""
    redis_url = config.core.redis_url
    print(f"my service is running with Redis URL: {redis_url}")
    # ...
```

## 4. Using Your Plugin

Once your package is installed (e.g., via `uv pip install .` or `uv sync` in the monorepo), enable it in your `tangram.toml`:

```toml
[core]
plugins = ["my_tangram_plugin"]
```

When you run `tangram serve`, the core application will automatically find and load your plugin's entry points, making the `/my-plugin` endpoint available and starting your background service.

<!-- # Implement a backend plugin

Implementing a backend plugin for tangram involves creating a standalone application (in Python or any other language) than can communicate with other components of the tangram system. This process should be able to:

- provide additional REST API endpoints;
- process real-time data through the Redis pub/sub

## REST API endpoint

Queries to the tangram endpoint is a very easy task. Any HTTP client can do the job, e.g. `httpx` in Python or `reqwest` in Rust. The REST API is provided by the tangram service, which is a FastAPI application.

The API documentation is available at <http://localhost:2345/tangram/docs> when the service is running.

Implementing a new endpoint requires a bit more work. Here, you have two possibilities:

- create a new endpoint on a different port, and use the `vite.config.js` configuration file to proxy requests to this endpoint.

- integrate your plugin with the main FastAPI application with the FastAPI router system. This allows you to add new endpoints to the main API while maintaining separation of concerns.

### Proxy to external resources

This is the simplest way to implement a new endpoint, as you can use any programming language, any web framework you like (Flask, FastAPI, etc.) and run the process on any node. The frontend will be able to access this endpoint through the proxy configuration.

In the `vite.config.js` file, you can add a proxy configuration to redirect requests to your plugin:

```javascript
server: {
  proxy: {
    "/api/my-plugin": `${host_address}:8001`, // where you serve your new process
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/my-plugin/, ''),
  },
},
```

### Extend the FastAPI application

!!! warning

    This approach is only possible in Python as the base backend is also implemented in Python using FastAPI. If you want to implement a plugin in another language, you should use the proxy approach described above.

For more complex plugins that need to integrate directly with the main FastAPI application, you can use FastAPI's router system. This approach allows your plugin to add endpoints to the main API while maintaining separation of concerns.

!!! tip

    The upside of this approach is that you can reuse all instances of the FastAPI application.

    The `docs/` endpoint will also automatically include your new endpoints in the API documentation.

In order to implement a FastAPI plugin, you need to create a Python package with a `__init__.py` file that defines the plugin's endpoints. Plugins can be located in the `src/tangram/plugins/` directory, and they should be structured as Python packages.

The main FastAPI application will automatically discover and register these plugins if they follow the naming convention and include an `__init__.py` file.

```python
from fastapi import APIRouter, FastAPI
from pydantic import BaseModel

# Create a router for your plugin
router = APIRouter(
    prefix="/example",  # All routes will be prefixed with /example
    tags=["example"],  # For API documentation organization
    responses={404: {"description": "Not found"}},
)


class ExampleResponse(BaseModel):
    data: str


# Define endpoints on your router
@router.get("/", response_model=ExampleResponse)
async def get_example() -> ExampleResponse:
    "An example endpoint that returns some data."
    return ExampleResponse(data="This is an example plugin response")


def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)

```

!!! warning

    Note that there is no activate/deactivate mechanism for backend plugins. If they are found in the `src/tangram/plugins/` directory, they will be automatically registered when the main FastAPI application starts.

    This is insignificant for most plugins creating new endpoints as they are usually stateless. However, if your plugin has a state (e.g. it subscribes to Redis channels, consume heavy resources at load time, etc.), then you may want to deactivate it. In that case, we recommend that you read an environment variable and conditionally execute commands in the `register_plugin` function. This way, you can control whether the plugin is active or not based on the environment variable.

## Communicate with Redis

Receiving and sending data from Redis is a common task for backend plugins. The process is based on a pub/sub system, where the plugin subscribes to specific channels to receive messages and can publish messages to other channels.

### Send messages to Redis

This is a straightforward task, regardless the programming language you use.

=== "Python"

    Use the `redis` Python package to publish messages to Redis channels:

    ```python
    import redis

    redis_client = redis.Redis.from_url("redis://localhost:6379")
    redis_client.publish("to:system:update", "Hello from plugin")

    ```

=== "Rust"

    Use the `redis` crate to publish messages to Redis channels:

    ```rust

    let redis_client = redis::Client::open("redis://localhost:6379").unwrap()?;
    let mut con = redis_client.get_multiplexed_async_connection().await?;
    con.publish("to:system:update", "Hello from plugin").await?;
    ```

### Receiving messages from Redis

The main difference between Redis messages and HTTP requests is that Redis messages are sent in real-time, while HTTP requests are stateless and can be processed at any time. This means that your plugin should be able to handle incoming messages asynchronously.

In Python, the `tangram` package provides a convenient way to interact with Redis based on the `redis-py` library. We provide a helper class to manage the connection, subscriptions, and message processing.

```python
import asyncio
from dataclasses import dataclass
from typing import NoReturn

from tangram.common.redis import Subscriber

@dataclass
class CurrentState:
    """A class to hold the current state of the plugin."""
    icao24: set[str]

class AircraftSubscriber(Subscriber[CurrentState]):
    """A subscriber that listens to aircraft updates."""

    async def message_handler(self, event: str, payload: str, pattern: str, state: CurrentState) -> None:
        # Process the message and update the state
        # For example, you can parse the message and update the icao24 set
        data = json.loads(message)
        state.icao24.add(data["icao24"])

async def main() -> NoReturn:
    # Run the subscriber to listen for aircraft updates in the main loop
    initial_state = CurrentState(icao24=set())
    aircraft_subscriber = AircraftSubscriber(
        redis_client="redis://localhost:6379",
        channels=["jet1090"],
        initial_state=initial_state,
    )
    # This call returns after creating a task running in the background
    await aircraft_subscriber.subscribe()

    while True:
        ...  # your main application logic here

if __name__ == "__main__":
    asyncio.run(main())
```

## Plugin to WebSocket events

To send messages to the frontend through the WebSocket connection, you can use the `channel` service. This service listens to Redis channels and forwards messages to the frontend clients.

The convention on the Redis channels is to use the `to:system:` prefix for messages sent from the backend to the frontend, and `from:system:` for messages sent from the frontend to the backend.

For instance, every time the map is moved or zoomed, the frontend sends a WebSocket message on the `bound-box` channel, which is then forwarded by `channel` on the Redis using the `from:system:bound-box` label. Conversely, state vector updates from the backend components are sent on the `to:streaming-(*):new-data` channel, which is then forwarded to the frontend clients labelled as `new-data`.[^1]

[^1]: The `(*)` placeholder is to be replaced by a unique identifier assigned to a session (When many browsers are connected to the same tangram service, they may be focused on different areas of the map, and thus receive different data). -->
