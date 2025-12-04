# tangram_core (Rust)

This crate provides the performance-critical foundations for the [`tangram`](https://github.com/open-aviation/tangram) framework.

## Modules

### `stream`

A library for handling geospatial data streams. It provides traits for `Positioned`, `Tracked`, and `Identifiable` entities and utilities for broadcasting state vectors to Redis.

### `bbox`

Manages viewport-based filtering. It efficiently tracks connected client viewports and filters stream data to only send relevant entities to the frontend.

### `channel` (Feature: `channel`)

A high-performance WebSocket server built on Axum and Redis Pub/Sub.
It implements a subset of the [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html) protocol to provide real-time, bidirectional communication between Python plugins, Rust services, and the Vue frontend.

Note that this component a heavily modified version of <https://github.com/emctoo/channel/tree/v0.2.8> and is licensed under the [MIT License](./src/channel/LICENSE).

## Testing

The `channel` module contains integration tests that require a running Redis instance.

```bash
podman run -d -p 6379:6379 redis
cargo test --features channel
```
