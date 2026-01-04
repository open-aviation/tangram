# tangram_core

`tangram_core` is the foundation of the [tangram](https://github.com/open-aviation/tangram) platform. It provides the essential scaffolding for custom geospatial visualisation tools.

While often used for aviation data, `tangram_core` itself is domain-agnostic. It handles the infrastructure (displaying maps, managing state, handling connections) so plugins can focus on the domain logic (decoding ADS-B, processing maritime signals, simulating weather).

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

## Components

- Backend: A Python application (FastAPI) that manages the lifecycle of plugins and background services.
- Channel: A high-performance Rust service that bridges Redis pub/sub with WebSockets for real-time frontend updates.
- Frontend: A Vue.js + Deck.gl shell that dynamically loads widgets and layers from installed plugins.

## Usage

### CLI

This package is rarely used alone. It is typically installed alongside plugins:

```bash
# with uv
uv tool install --with tangram-jet1090 --with tangram-system tangram-core
# with pip
pip install tangram-core tangram-jet1090 tangram-system
# launch!
tangram serve --config /path/to/your/tangram.toml
```

### Programmatic

You can also launch `tangram` from a Python script or a Jupyter notebook using `tangram_core.launch()`.

This provides direct access to the backend state (e.g. Redis client, HTTP client), enabling you to spawn data or interact with services programmatically.

```py
import tangram_core

async with tangram_core.launch(open_browser=True) as t:
    await t.redis_client.set("my_key", "value")
```
