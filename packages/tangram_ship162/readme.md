# tangram_ship162

The `tangram_ship162` plugin integrates AIS data from a `ship162` instance, enabling real-time visualization and historical analysis of maritime traffic.

It provides:

- A background service to ingest AIS messages.
- A REST API endpoint to fetch ship trajectories.
- Frontend widgets for visualizing ships on the map.

## About Tangram

`tangram_ship162` is a plugin for `tangram`, an open framework for modular, real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-ship162 tangram-core
# with pip
pip install tangram-core tangram-ship162
```
