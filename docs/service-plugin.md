# Tangram Service Plugins: Backend Extension System

Tangram's backend architecture is built around a modular plugin system that allows for easy extension and customization. Each plugin operates as an independent process that can provide new functionality through either RESTful APIs or real-time data processing via WebSocket events.

## Overview

Service plugins are standalone Python processes that extend Tangram's backend capabilities. They can:

1. Provide additional API endpoints through web services
2. Process and generate real-time data through WebSocket events via Redis pub/sub
3. Combine both approaches for comprehensive functionality

This architecture allows for a highly modular and flexible system where plugins can be developed, deployed, and maintained independently.

## Types of Service Plugins

### 1. Web Service Plugins

Web service plugins expose HTTP endpoints that can be accessed by the frontend or other systems. These plugins:

- Run as independent web services
- Handle HTTP requests and provide responses
- Are typically accessed through a proxy configured in the Tangram frontend
- Can implement any functionality accessible through HTTP APIs

### 2. WebSocket Event Plugins

WebSocket event plugins interact with the system through Redis pub/sub channels. These plugins:

- Subscribe to Redis topics to receive events
- Process incoming data
- Publish results back to Redis topics for real-time consumption
- Don't require direct HTTP access from clients

## Creating Service Plugins

### Common Requirements

All Tangram service plugins should:

1. Be implemented as standalone Python processes
2. Accept configuration via command-line arguments and environment variables
3. Log information appropriately for debugging and monitoring
4. Handle graceful startup and shutdown

### Web Service Plugin Example

A web service plugin typically:

1. Sets up a web framework (FastAPI, Flask, etc.)
2. Defines routes and handlers
3. Provides API documentation
4. Runs on a specific port

**Example Integration with Frontend**

To access a web service plugin from the frontend, add a proxy configuration to Vite:

```javascript
// vite.config.js
export default defineConfig({
  // ...
  server: {
    proxy: {
      '/api/my-plugin': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/my-plugin/, '')
      }
    }
  }
})
```

### WebSocket Event Plugin Example

The `system.py` plugin demonstrates how to create a plugin that generates WebSocket events:

```python
import json
import logging
import time
from datetime import UTC, datetime
import pandas as pd
import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)

DT_FMT = "%H:%M:%S"

def uptime_html(counter):
    el = "uptime"
    return {
        "el": el,
        "html": f"""<span id="{el}">{pd.Timedelta(counter, unit="s")}</span>""",
    }

def info_utc_html(dtfmt=DT_FMT):
    el = "info_utc"
    now_utc = datetime.now(UTC)
    return {
        "el": el,
        "html": f"""<span id="{el}">{now_utc.strftime(dtfmt)}</span>""",
        'now': now_utc.isoformat(),
    }

def info_local_html(dtfmt=DT_FMT):
    el = "info_local"
    now_utc = datetime.now(UTC)
    return {
        "el": el,
        "html": f"""<span id="{el}">{datetime.now().strftime(dtfmt)}</span>""",
        'now': now_utc.isoformat(),
    }

def server_events(redis_url: str):
    counter = 0
    redis_client = redis.Redis.from_url(redis_url)

    log.info("serving system events ...")
    while True:
        redis_client.publish("to:system:update-node", json.dumps(uptime_html(counter)))
        redis_client.publish("to:system:update-node", json.dumps(info_utc_html()))
        redis_client.publish("to:system:update-node", json.dumps(info_local_html()))
        counter += 1
        time.sleep(1)

if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", dest="redis_url", 
                       default=os.getenv("REDIS_URL", "redis://redis:6379"))
    args = parser.parse_args()
    server_events(args.redis_url)
```

This plugin:
1. Generates system information like time and uptime
2. Formats the data into HTML snippets with IDs
3. Publishes the data to the `to:system:update-node` Redis topic
4. Runs in an infinite loop, updating every second

### More Advanced Example: Trajectory Plugin

The `trajectory.py` plugin shows a more complex example that both subscribes to and publishes events:

```python
class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        self.redis_url: str = redis_url
        self.channels: List[str] = channels
        self.history_db = HistoryDB(use_memory=False)

        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        # Handle coordinate data when an aircraft is selected
        if channel == "coordinate" and state.icao24:
            timed_message = msgspec.json.decode(data)
            if timed_message["icao24"] == state.icao24:
                icao24 = timed_message["icao24"]
                
                # Fetch trajectory from jet1090 service
                records = await jet1090_restful_client.icao24_track(icao24) or []
                history_trajectory = [[r.latitude, r.longitude] for r in records 
                                     if r.latitude is not None and r.longitude is not None]

                trajectory = history_trajectory
                await self.redis.publish(
                    f"to:trajectory-{state.icao24}:new-data", 
                    msgspec.json.encode(trajectory)
                )
                log.info("Published trajectory for %s with %d points", 
                         state.icao24, len(trajectory))

        # Handle aircraft selection events
        if channel == "from:system:select":
            payload = msgspec.json.decode(data)
            icao24 = payload["icao24"]
            state.icao24 = icao24
            state.trajectory = [[el["latitude"], el["longitude"]] 
                               for el in self.history_db.list_tracks(icao24)]
            log.info("Selected aircraft: %s", state.icao24)
```

This plugin:
1. Subscribes to both `coordinate` events and `from:system:select` events
2. Maintains state about the currently selected aircraft
3. Fetches trajectory data when a new position is received
4. Publishes trajectory data to a dynamic Redis topic based on the aircraft ID

## Redis Topic Conventions

Tangram uses specific naming conventions for Redis topics:

### For Backend to Frontend Communication:
- Format: `to:<channel>:<event>`
- Example: `to:system:update-node`
- Purpose: Send data from backend plugins to frontend clients

### For Frontend to Backend Communication:
- Format: `from:<channel>:<event>`
- Example: `from:system:select`
- Purpose: Send user actions or requests from frontend to backend plugins

## Running Service Plugins

Service plugins can be run directly or managed by Tangram's process-compose system:

### Direct Execution

```bash
python -m tangram.plugins.system --redis-url redis://localhost:6379
```

### Configuration in process-compose.yaml

```yaml
processes:
  plugins/system:
    environment:
      - "REDIS_URL=redis://redis:6379"
    working_dir: /home/user/tangram/service
    command: python -m tangram.plugins.system
    availability:
      restart: "always"
```

## Best Practices

### For All Plugins

1. **Configuration Flexibility**: Support both environment variables and command-line arguments
2. **Error Handling**: Implement robust error handling to prevent crashes
3. **Logging**: Use appropriate logging levels for debugging and production
4. **Graceful Shutdown**: Handle termination signals properly
5. **Documentation**: Document the purpose, inputs, and outputs of your plugin

### For Web Service Plugins

1. **API Documentation**: Provide OpenAPI/Swagger documentation
2. **Authentication**: Implement appropriate authentication if needed
3. **Rate Limiting**: Consider rate limiting for public endpoints
4. **CORS Configuration**: Set up proper CORS headers if accessed directly

### For WebSocket Event Plugins

1. **State Management**: Consider how to manage state between events
2. **Message Format**: Use consistent message formats (JSON recommended)
3. **Topic Naming**: Follow the established naming conventions
4. **Error Propagation**: Publish errors as events when appropriate

## Testing Service Plugins

### Testing Web Service Plugins

Web service plugins can be tested using HTTP client libraries:

```python
import pytest
import requests

def test_api_endpoint():
    response = requests.get("http://localhost:8001/api/resource")
    assert response.status_code == 200
    data = response.json()
    assert "expected_field" in data
```

### Testing WebSocket Event Plugins

WebSocket event plugins can be tested using a Redis client:

```python
import pytest
import redis
import json
import time

@pytest.fixture
def redis_client():
    return redis.Redis.from_url("redis://localhost:6379")

def test_event_publishing(redis_client):
    # Create a pubsub instance to receive messages
    pubsub = redis_client.pubsub()
    pubsub.subscribe("to:system:update-node")
    
    # Wait for a message
    message = None
    for _ in range(10):  # Try a few times
        message = pubsub.get_message(timeout=1.0)
        if message and message["type"] == "message":
            break
        time.sleep(0.1)
    
    # Verify the message
    assert message is not None
    assert message["type"] == "message"
    data = json.loads(message["data"])
    assert "el" in data
```

## Conclusion

Tangram's service plugin architecture provides a flexible and powerful way to extend the system's backend capabilities. By designing plugins as independent processes that communicate through well-defined interfaces (HTTP APIs or Redis pub/sub), Tangram enables a modular development approach where components can be developed, deployed, and scaled independently.

Whether you need to add new API endpoints, process real-time data, or both, the service plugin system provides a consistent framework that integrates smoothly with the rest of the Tangram ecosystem.
