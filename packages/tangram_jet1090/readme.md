# tangram_jet1090

The `tangram_jet1090` plugin enables real-time tracking of aircraft by integrating with a `jet1090` instance, which decodes ADS-B signals received from nearby aircraft.

It provides:

- A background service to maintain real-time state of visible aircraft.
- A REST API endpoint to fetch historical trajectories.
- Frontend widgets for the tangram web interface.

## About Tangram

`tangram_jet1090` is a plugin for `tangram`, an open framework for modular, real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-jet1090 tangram-core
# with pip
pip install tangram-core tangram-jet1090
```
