# Implement a backend plugin

Implementing a backend plugin for tangram involves creating a standalone application (in Python or any other language) than can communicate with other components of the tangram system. This process should be able to:

- provide additional REST API endpoints;
- process real-time data through the Redis pub/sub

## REST API endpoint

Queries to the tangram endpoint is a very easy task. Any HTTP client can do the job, e.g. `httpx` in Python or `reqwest` in Rust. The REST API is provided by the tangram service, which is a FastAPI application.

The API documentation is available at <http://localhost:2345/docs> when the service is running.

Implementing a new endpoint requires a bit more work. Here, you have two possibilities:

- create a new endpoint on a different port, and use the `vite.config.js` configuration file to proxy requests to this endpoint.

- integrate your plugin with the main FastAPI application with the FastAPI router system. This allows you to add new endpoints to the main API while maintaining separation of concerns.

### Proxy requests to a different endpoint

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

For more complex plugins that need to integrate directly with the main FastAPI application, you can use FastAPI's router system. This approach allows your plugin to add endpoints to the main API while maintaining separation of concerns.

The upside of this approach is that you can reuse all instances of the FastAPI application, such as the authentication system, the CORS configuration, etc. The `docs/` endpoint will also automatically include your new endpoints in the API documentation.

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


# This function will be called by the main FastAPI application
# Place it in __init__.py to register the plugin
def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)

```

## Communicate with Redis

## Provide WebSocket events
