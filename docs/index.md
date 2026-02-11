# An open framework for modular, real-time air traffic management research

**tangram** is an open research framework for ADS-B and Mode S flight surveillance data designed for various **real-time aviation research topics** such as GNSS jamming detection, aviation weather monitoring, emission analysis, and airport performance monitoring.

<img src="./screenshot/tangram_screenshot_fr.png" alt="web interface" onmouseover="this.src='./screenshot/tangram_screenshot_nl.png'" onmouseout="this.src='./screenshot/tangram_screenshot_fr.png'" />

## Introduction

`tangram` is built on a plugin-first architecture. It provides a lightweight core application, and all major functionality, from data processing to new UI widgets, is added through `pip`-installable packages.

The core framework includes a **JavaScript**-based **web application** and a **backend powered by Python and Rust**. This foundation is designed to be extended, allowing researchers to develop and integrate their own plugins for specific research needs. This modularity enables the community to contribute to the platform, encouraging collaboration and knowledge sharing.

## Contents

- [Quickstart](quickstart.md): A step-by-step guide to get started with tangram
- [Configuration](configuration.md): Information on how to configure the system for your needs
- [Architecture](architecture/overview.md): An overview of the system architecture and components
- [Plugins](plugins/overview.md): Extend the system with custom functionalities
- [Contribute to tangram](contribute.md): Guidelines for contributing to the project

For more information, visit [GitHub](https://github.com/open-aviation/tangram)
