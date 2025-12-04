# tangram_system

The `tangram_system` plugin provides system monitoring capabilities for the tangram framework.

It includes a background service that broadcasts server metrics (CPU, RAM, Uptime) to connected frontend clients via the realtime channel.

## About Tangram

`tangram_system` is a plugin for `tangram`, an open framework for modular, real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-system tangram-core
# with pip
pip install tangram-core tangram-system
```
