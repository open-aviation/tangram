# Explore Plugin

The `tangram_explore` plugin provides a quick way to spawn visualise arbitrary dataframes (polars/pandas) on the map.

It is strongly inspired [lonboard](https://github.com/developmentseed/lonboard).

## Overview

- Since the plugin sends the entire Parquet dataset to the browser for decoding and rendering, it is best suited for "small" data. Very large dataframes will lag the browser.
- Uses [`arro3`](https://github.com/kylebarron/arro3) to convert any dataframe supporting the [Arrow C Stream Interface](https://arrow.apache.org/docs/format/CStreamInterface.html) into Parquet bytes.
- Data is stored on the Python side and metadata is broadcasted to all connected clients.
- Browser fetches the Parquet data via HTTP, decodes it using [`parquet-wasm`](https://github.com/kylebarron/parquet-wasm), and renders it using `deck.gl`.

## Configuration

To enable this plugin, add `"tangram_explore"` to the `plugins` list in your `tangram.toml`.

```toml title="tangram.toml"
[core]
plugins = ["tangram_explore"]

[plugins.tangram_explore]
enable_3d = true
```

See [`tangram_explore.ExploreConfig`][] for more information.

## Future Work

- Support for LineString and Polygon layers (requires GeoArrow processing).
- Drag-and-drop file upload in the sidebar.
- Synchronization

## Examples

### Basic

Spawn two intersecting diagonal lines as 100 scatter points, centred at (0, 0).

![map interface](../screenshot/explore_basic.png)

=== "Interactive (Jupytext)"

    ```py
    --8<-- "packages/tangram_explore/examples/basic_interactive.py"
    ```

=== "Script"

    ```py
    --8<-- "packages/tangram_explore/examples/basic.py"
    ```
