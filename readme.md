# tangram

[![image](https://img.shields.io/pypi/v/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core)
[![image](https://img.shields.io/pypi/l/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core)
[![image](https://img.shields.io/pypi/pyversions/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core)

[**Documentation & Quickstart**](https://mode-s.org/tangram/quickstart/)

**tangram** is a modular platform for real-time multidisciplinary air traffic management research.

Unlike monolithic architectures, tangram is engineered as a fully decoupled plugin ecosystem, allowing researchers to fuse several data sources: Mode S, weather models, maritime AIS, and system metrics without one component crashing the other.

It leverages Rust for high-throughput stream processing and WebSocket handling, Python for accessible plugin logic, and Redis as a unified event bus. The frontend is a micro-application shell that dynamically loads Vue.js widgets and Deck.gl layers only when required.

```sh
# install via uv (recommended) or pip
uv tool install --with tangram-jet1090 --with tangram-explore tangram-core

# start the message bus (Redis is the heartbeat of tangram)
podman run -d -p 6379:6379 redis:alpine

# launch! see the documentation for how to configure it
tangram serve --config tangram.toml
```

![preview](./docs/screenshot/tangram_screenshot_fr.png)

## Highlights

- **Plugin-first**: Everything from data decoding to UI widgets is a plugin. Customize your stack by installing only what you need.
- Critical paths (WebSockets, stream filtering) are written in Rust and exposed to Python via PyO3. This provides the ease of Python scripting with native performance.
- The `tangram-history` plugin buffers high-velocity streams from any data source (e.g. Mode S, Maritime AIS) into Apache Arrow RecordBatches and flushes them to Delta Lake tables. This enables convenient high performance OLAP queries on your data without configuring a separate database.

## FAQ

**Why does a visualisation tool require Redis?**

> Inspired by modular avionics, we put a strong emphasis on decoupling code between different disciplines.
>
> Redis serves as the "central nervous system" for exchanging data, allowing bidirectional realtime transfer of messages between plugins and the frontend.
>
> We currently have rudimentary support for a multiplayer-based experience, and eventually plan to support multi-agent air traffic control scenarios. Redis pub/sub is critical to enable this.

**Can I use this for non-aviation data?**

> Yes. While the official plugins focus on air (`tangram_jet1090`) and maritime traffic (`tangram_ship162`), the core is domain-agnostic. Any data you can push to Redis or serialize to Arrow can be visualized. The `tangram_explore` plugin is specifically designed to visualize generic geospatial DataFrames (scatter plots, trajectories) without writing a full backend plugin.

**How do I get live planes?**

> Tangram is a platform for visualization and analysis, and does not decode radio.
>
> We recommend running [`jet1090`](https://github.com/xoolive/jet1090) (a modern Rust implementation of `dump1090`). It feeds raw Mode-S frames into Redis. The `tangram_jet1090` plugin then consumes that stream, filters based on the map's bounding box and pushes updates to the map.
>
> `Radio -> jet1090 -> redis -> tangram -> you`
>
> We cover how to set this up in detail in our [documentation](https://mode-s.org/tangram/quickstart/#example-2-add-live-aircraft-data).

**Is this suitable for offline use?**

> Yes, with preparation. The default configuration uses online tile servers (CartoDB/Protomaps) for the basemap. You can configure `tangram.toml` to serve local vector tiles (PMTiles) or style files. However, plugins relying on external APIs (like `tangram_weather` fetching ARPEGE GRIB files) will naturally require internet access.

## Documentation

[![docs](https://github.com/open-aviation/tangram/actions/workflows/docs.yml/badge.svg)](https://github.com/open-aviation/tangram/actions/workflows/docs.yml)

Full documentation, including quickstart guides and API references, is available at <https://mode-s.org/tangram/>.

## Tests

[![build](https://github.com/open-aviation/tangram/actions/workflows/podman.yml/badge.svg)](https://github.com/open-aviation/tangram/actions/workflows/podman.yml)

Each component is tested independently. The project is currently under early development and have limited unit tests in `tangram_core`. Binary wheels for all platforms are built on each push.

## Cite this work

[![DOI](https://joss.theoj.org/papers/10.21105/joss.08662/status.svg)](https://doi.org/10.21105/joss.08662)

If you find this work useful and use it in your academic research, you may use the following BibTeX entry.

JOSS:

```bibtex
@article{tangram_2025_joss,
  author = {Olive, Xavier and Sun, Junzi and Huang, Xiaogang and Khalaf, Michel},
  doi = {10.21105/joss.08662},
  journal = {Journal of Open Source Software},
  month = nov,
  number = {115},
  pages = {8662},
  title = {{tangram, an open platform for modular, real-time air traffic management research}},
  url = {https://joss.theoj.org/papers/10.21105/joss.08662},
  volume = {10},
  year = {2025}
}
```

SESAR Innovation Days 2025:

```bibtex
@inproceedings{tangram_2025_sids25,
  author = {Olive, Xavier and Cheung, Yan Lok and Sun, Junzi},
  title = {tangram in Action: Practical Use Cases for Real-time Open Aviation Research},
  booktitle = {SESAR Innovation Days},
  year = {2025},
  month = {December},
  url = {https://www.sesarju.eu/sites/default/files/documents/sid/2025/papers/SIDs_2025_paper_99-final.pdf}
}
```

## Funding

This project is currently funded by the Dutch Research Council (NWO)'s Open Science Fund, **OSF23.1.051**: <https://www.nwo.nl/en/projects/osf231051>.

## History

In 2020, @junzis and @xoolive published a paper [Detecting and Measuring Turbulence from Mode S Surveillance Downlink Data](https://research.tudelft.nl/en/publications/detecting-and-measuring-turbulence-from-mode-s-surveillance-downl-2) on how real-time Mode S data can be used to detect turbulence.

Based on this method, @MichelKhalaf started developing this tool as part of his training with @xoolive in 2021, which was completed in Summer 2022. After that, the project was then lightly maintained by @xoolive and @junzis, while we have been applying for funding to continue this tool.

Then in 2023, we received funding from NWO to continue the development of this tool. With this funding, @emctoo from [Shinetech](https://www.shinetechsoftware.com) was hired to work alongside us on this open-source project and helped to improve the codebase and documentation, making it more accessible, improving the design with a component-based architecture. (version 0.1)

After reviewing the existing project for the JOSS submission, @abc8747 kindly contributed and helped to improve the software engineering practices so that all components can be packaged as simple-to-install Python packages. (version 0.2)
