---
title: tangram, an open platform for modular, real-time air traffic management research
tags:
  - trajectory
  - ADS-B
  - Mode S
  - air traffic management
  - data visualization
authors:
  - affiliation: 1
    name: Xavier Olive
    orcid: 0000-0002-2335-5774
  - affiliation: 2
    name: Junzi Sun
    orcid: 0000-0003-3888-1192
  - affiliation: 3
    name: Xiaogang Huang
  - affiliation: 1
    name: Michel Khalaf
affiliations:
  - index: 1
    name: ONERA -- DTIS, Université de Toulouse, Toulouse, France
  - index: 2
    name: Delft University of Technology, Delft, The Netherlands
  - index: 3
    name: Shinetech Software, Beijing, China
bibliography: paper.bib
date: "14 May 2025"
---

# Summary

tangram is an open research framework for ADS-B and Mode S flight surveillance data. Initially developed for turbulence detection research, it has since evolved into a versatile tool applicable to real-time aviation research topics, including GNSS jamming detection, aviation weather monitoring, emission analysis, and airport performance monitoring.

The system comprises a JavaScript-based web application and a backend implemented in Python or Rust, depending on performance requirements. The web application is modular, enabling users to add custom plugins for data processing and analysis. The backend handles data collection, storage, and processing, while the frontend offers an interface for visualizing and interacting with the data.

The whole framework is designed to be extensible, allowing researchers to develop and integrate their plugins for specific research needs. This modularity enables the community to contribute to the platform.

![The tangram web application](../docs/screenshot/tangram_screenshot_fr.png){#tangram}

# Statement of need

The world of aviation involves many stakeholders producing a vast amount of data, but most of it is not publicly available for confidentiality and security reasons. Research in aviation is also often limited by the availability of data, but this has evolved in the past decade thanks to open data initiatives [@eurocontrol_rd].

ADS-B and Mode S enable aircraft to broadcast their position and flight parameters, allowing real-time air traffic data collection. This data supports research on flight patterns [@olive_training_2025], emissions [@seymour_fuel_2020], and air traffic performance [@schultz_predictive_2021]. Since ADS-B is unencrypted and easily decoded with software-defined radios, many open-source tools, such as dump1090 [@dump1090], pyModeS [@sun_pymodes_2020], and platforms like The OpenSky Network [@opensky2014], have emerged, providing researchers with free access to real-time and historical aviation data.

Most research initiatives and proofs of concept based on ADS-B data are limited to the use of historical data [@olive_traffic_2019]. However, the potential impact of such research depends on the possibility of adapting the algorithms to real-time data. The tangram framework aims to bridge this gap by providing a platform for real-time data collection and analysis.

# Core structure of the framework

![Core structure of the framework](../docs/screenshot/tangram_diagram.pdf){#core-structure}

The tangram framework consists of a suite of independent components that can be combined to create a powerful and flexible system (see \autoref{core-structure}). The web application is built upon the Vite framework and consists of a series of Vue plugins. The interaction between the frontend and backend is based on REST APIs and WebSocket connections. The REST API (the `tangram` application) is used for data retrieval and management, while the WebSocket connection (through the `channel` executable) allows for real-time communication between the frontend and backend. The backend is responsible for data collection, storage, and processing. All the components communicate through a Redis pub/sub system, which allows for efficient data exchange between components and real-time updates.

## jet1090

The `jet1090` [@jet1090] tool is a Rust-based ADS-B decoder that can be used to decode ADS-B messages from a variety of sources, including software-defined radio devices. It is designed to be fast and efficient, making it suitable for real-time applications. `jet1090` is comparable to the historical `dump1090` decoder [@dump1090], with additional features such as the ability to decode Extended Mode S messages.

![The table view of `jet1090` in the terminal](../docs/screenshot/jet1090.png){#jet1090}

## planes

The `planes` module is a Rust-based component that maintains a real-time table of aircraft states. It updates aircraft positions and parameters using data from `jet1090`, ensuring the frontend has current information. Since different ADS-B messages provide different parameters (e.g., position, speed, identification), the state vector table aggregates the latest values, enabling accurate aircraft display on the map.

## trajectory

The `trajectory` module is a Python-based component that provides the history of data for a given aircraft. It is responsible for storing and retrieving historical data about the aircraft's position and other parameters. The component uses the data stored by the Redis system and reformats it to be used by the frontend in a more standard JSON-like format.

## tangram REST API

The core `tangram` component is a Python-based REST API that provides data retrieval and management capabilities. It is responsible for handling requests from the frontend and providing the necessary data for visualization and analysis. The API is designed to be modular and extensible, allowing the user to add their endpoints and functionality as needed. Basic endpoints provided by the API include the data from `trajectory` and `planes`. Since the component is based on FastAPI, it is also possible to dynamically add new endpoints to the API at the plugin level.

## channel

The `channel` component [@channel] is a Rust-based WebSocket connection that makes the bridge between the frontend and the Redis pub/sub system. It is responsible for providing real-time updates from and to the frontend.

# The plugin system in tangram

The tangram system is designed to be extensible. Users can easily implement particular functionalities by creating their own backend and frontend plugins.

A backend plugin is usually an executable or a Python module which could, for example:

- listen to a Redis channel;
- access private data or services requiring authentication;
- post-process and enrich data;
- share the resulting information on a Redis channel or REST endpoint.

A frontend plugin will usually be a Vue component, which could, for example:

- add HTML elements to the web application (in the navigation bar or the sidebar);
- capture user interactions (e.g., mouse clicks, keyboard events);
- send requests to the backend (e.g., through the REST API or WebSocket);
- display data on the map (e.g., by adding markers, drawing lines, etc.)

# Potential applications

The tangram framework has been thought to display ADS-B data on a map, similarly to the OpenSky Network or FlightRadar24, and to enrich it to include extra visualization features based on previously developed algorithms for turbulence detection [@olive_turbulence_2020], GNSS jamming detection [@felux_impacts_2024], anomaly detection [@basora_recent_2019], airspace occupancy metrics or aircraft trajectory prediction [@jarry_neural_2025].

# Acknowledgement

This project has been funded by the Dutch Research Council (NWO) Open Science Fund OSF 23.1.051 <https://www.nwo.nl/en/projects/osf231051>

# References
