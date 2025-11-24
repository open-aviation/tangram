# tangram

tangram is an open framework that aggregates and processes ADS-B and Mode S surveillance data for real-time analysis. It provides a flexible plugin architecture where users can easily implement custom analyzers for their specific needs.

The system consists of a JavaScript frontend and a Python backend built with FastAPI. The backend efficiently aggregates data from multiple receiver streams and exposes a WebSocket interface, enabling real-time data visualization and analysis in the browser-based frontend.

![preview](./docs/screenshot/tangram_screenshot_fr.png)

## Documentation

[![docs](https://github.com/open-aviation/tangram_core/actions/workflows/docs.yml/badge.svg)](https://github.com/open-aviation/tangram_core/actions/workflows/docs.yml)

Documentation is available at <https://mode-s.org/tangram_core/>

## Tests

Unit tests are limited to what invidual components can provide, including [jet1090](https://github.com/xoolive/rs1090/actions).\
The system is designed to be modular, so each component can be tested independently.

[![build](https://github.com/open-aviation/tangram_core/actions/workflows/podman.yml/badge.svg)](https://github.com/open-aviation/tangram_core/actions/workflows/podman.yml)

Integration tests is currently limited to the construction of the container image, with the `just c-build` command.

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

This project is currently funded by the Dutch Research Council (NWO)'s Open Science Fund, **OSF23.1.051**: https://www.nwo.nl/en/projects/osf231051.

## History

In 2020, @junzis and @xoolive published a paper [Detecting and Measuring Turbulence from Mode S Surveillance Downlink Data](https://research.tudelft.nl/en/publications/detecting-and-measuring-turbulence-from-mode-s-surveillance-downl-2) on how real-time Mode S data can be used to detect turbulence.

Based on this method, @MichelKhalaf started developing this tool as part of his training with @xoolive in 2021, which was completed in Summer 2022. After that, the project was then lightly maintained by @xoolive and @junzis, while we have been applying for funding to continue this tool.

And in 2023, we received funding from NWO to continue the development of this tool. With this funding, @emctoo from [Shinetech](https://www.shinetechsoftware.com) was hired to work alongside us on this open-source project.
