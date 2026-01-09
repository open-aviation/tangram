# Explore Plugin

The `tangram_explore` plugin provides a quick way to spawn visualise arbitrary dataframes (polars/pandas) on the map.

It is strongly inspired [lonboard](https://github.com/developmentseed/lonboard).

## Overview

- Uses [`arro3`](https://github.com/kylebarron/arro3) to convert any dataframe supporting the [Arrow C Stream Interface](https://arrow.apache.org/docs/format/CStreamInterface.html) into Parquet bytes.
- Data is stored on the Python side and metadata is broadcasted to all connected clients
- Browser fetches the Parquet data via HTTP, decodes it using [`parquet-wasm`](https://github.com/kylebarron/parquet-wasm), and renders it using `deck.gl`

## Future Work

- Support for LineString and Polygon layers (requires GeoArrow processing).
- Drag-and-drop file upload in the sidebar.
- Synchronization
