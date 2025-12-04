# tangram_history

The `tangram_history` plugin provides a generic framework for persisting and querying historical surveillance data within the `tangram` ecosystem. It is designed to work alongside other data ingestion plugins, such as `tangram_jet1090` and `tangram_ship162`, to store time-ordered trajectories of various entities.

## About Tangram

`tangram_history` is a plugin for `tangram`, an open framework for modular, real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-history tangram-core
# with pip
pip install tangram-core tangram-history
```
