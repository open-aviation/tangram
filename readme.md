# tangram

[![image](https://img.shields.io/pypi/v/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core)
[![image](https://img.shields.io/pypi/l/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core)
<!-- we dont have pypi classifiers yet for 0.2.0 yet -->
<!-- [![image](https://img.shields.io/pypi/pyversions/tangram-core.svg)](https://pypi.python.org/pypi/tangram-core) -->

**tangram** is a modular platform for real-time geospatial and air traffic management research. Built on a plugin-first architecture, it enables researchers to visualize and analyze moving entities, from aircraft to ships to weather patterns, in a unified web interface.

The system combines a high-performance backend (Python & Rust) with a modern web frontend (Vue & Deck.gl) to handle massive datasets with low latency. While the official plugins focus on air traffic management, the core framework is generic and adaptable to any domain.

![preview](./docs/screenshot/tangram_screenshot_fr.png)

## Highlights

- **Plugin-first**: Everything from data decoding to UI widgets is a plugin. Customize your stack by installing only what you need.
- **Real-time**: Built on Redis and WebSockets for instant streaming of state vectors and events.
- **Performance**: Critical data paths are written in Rust. Historical data is managed efficiently using Apache Arrow and Delta Lake.

## Documentation

[![docs](https://github.com/open-aviation/tangram/actions/workflows/docs.yml/badge.svg)](https://github.com/open-aviation/tangram/actions/workflows/docs.yml)

Full documentation, including quickstart guides and API references, is available at <https://mode-s.org/tangram/>.

## Tests

[![build](https://github.com/open-aviation/tangram/actions/workflows/podman.yml/badge.svg)](https://github.com/open-aviation/tangram/actions/workflows/podman.yml)

The system is designed to be modular, so each component is tested independently. Integration testing is currently limited to the construction of the container image, via the container build process (`just c-build`).

## Cite this work

[![DOI](https://joss.theoj.org/papers/10.21105/joss.08662/status.svg)](https://doi.org/10.21105/joss.08662)

If you find this work useful and use it in your academic research, you may use the following BibTeX entry.

```bibtex
@article{tangram_2025,
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

## Funding

This project is currently funded by the Dutch Research Council (NWO)'s Open Science Fund, **OSF23.1.051**: <https://www.nwo.nl/en/projects/osf231051>.

## History

In 2020, @junzis and @xoolive published a paper [Detecting and Measuring Turbulence from Mode S Surveillance Downlink Data](https://research.tudelft.nl/en/publications/detecting-and-measuring-turbulence-from-mode-s-surveillance-downl-2) on how real-time Mode S data can be used to detect turbulence.

Based on this method, @MichelKhalaf started developing this tool as part of his training with @xoolive in 2021, which was completed in Summer 2022. After that, the project was then lightly maintained by @xoolive and @junzis, while we have been applying for funding to continue this tool.

Then in 2023, we received funding from NWO to continue the development of this tool. With this funding, @emctoo from [Shinetech](https://www.shinetechsoftware.com) was hired to work alongside us on this open-source project and helped to improve the codebase and documentation, making it more accessible, improving the design with a component-based architecture. (version 0.1)

After reviewing the existing project for the JOSS submission, @abc8747 kindly contributed and helped to improve the software engineering practices so that all components can be packaged as simple-to-install Python packages. (version 0.2)
