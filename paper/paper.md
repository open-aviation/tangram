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
tangram is an open research framework for ADS-B and Mode S flight surveillance data. Initially developed for turbulence detection research, it has since evolved into a versatile tool applicable to various real-time aviation research topics, including GNSS jamming detection, aviation weather monitoring, emission analysis, and airport performance monitoring.

The system comprises a JavaScript-based web application and a backend implemented in Python or Rust, depending on performance requirements. The web application is modular, enabling users to add custom plugins for data processing and analysis. The backend handles data collection, storage, and processing, while the frontend offers a user-friendly interface for visualizing and interacting with the data.

The whole framework is designed to be extensible, allowing researchers to develop and integrate their plugins for specific research needs. This modularity enables the community to contribute to the platform, fostering collaboration and knowledge sharing.

![The tangram web application](../docs/screenshot/tangram_screenshot_fr.png){#tangram}

# Statement of need

The world of aviation involves many stakeholders producing a vast amount of data, but most of it is not publicly available for confidentiality and security reasons. Research in aviation is also often limited by the availability of data, but this has evolved in the past decade thanks to the introduction of open data initiatives [@eurocontrol_rd] [@nilsson_swedish_2023]. ADS-B and Mode S are technologies that allow aircraft to broadcast their position and other flight parameters, making it possible to collect real-time data on air traffic. Such data has been widely used for various research purposes, such as studying flight patterns [@olive_training_2025], estimating aircraft emissions [@seymour_fuel_2020], or monitoring air traffic performance [@schultz_predictive_2021].

ADS-B is not encrypted, and it is very easy to build a decoder to receive and decode the data with software-defined radios. This openness has favored the emergence of various open-source projects and tools for working with ADS-B data, such as dump1090 and pyModeS [@sun_pymodes_2020], and platforms like The OpenSky Network [@opensky2014], a non-profit initiative that provides open access to real-time and historical air traffic data, which grants free access to researchers to study various aspects of aviation.

Most research initiatives and proofs of concept based on ADS-B data are limited to the use of historical data [@olive_traffic_2019]. However, the potential impact of such research depends on the possibility of adapting the algorithms to real-time data. The tangram framework aims to bridge this gap by providing a platform for real-time data collection and analysis, enabling researchers to conduct experiments and develop new algorithms with this real-time data efficiently.

# Core structure of the framework

The tangram framework consists of a suite of independent components that can be combined to create a powerful and flexible system, as illustrated on \autoref{core-structure}. The web application is built upon the Vite framework and consists of a series of Vue plugins that provide a module architecture for the frontend.

![Core structure of the framework](../docs/screenshot/tangram_diagram.pdf){#core-structure}

The interaction between the frontend and backend is based on REST APIs and WebSocket connections. The REST API (the `tangram` application) is used for data retrieval and management. At the same time, the WebSocket connection (through the `channel` executable) allows for real-time communication between the frontend and backend.

The backend is responsible for data collection, storage, and processing. All the components communicate through a Redis pub/sub system, which allows for efficient data exchange between components and real-time updates.

: List of backend components \label{components}

| **Backend component** | **Description**                              |
| --------------------- | -------------------------------------------- |
| `jet1090`             | decode Mode S and ADS-B messages             |
| `planes`              | maintain a state vector table of aircraft    |
| `trajectory`          | get the history of data for a given aircraft |
| `tangram`             | REST API for data retrieval and management   |
| `channel`             | WebSocket connection for real-time updates   |

The most important components of the backend are listed in \autoref{components} and presented in more detail in the following sections. The Redis pub/sub is not detailed below as it is a standard component used key-in-hand.

## jet1090

The `jet1090` (<https://mode-s.org/jet1090>) tool is a Rust-based ADS-B decoder that can be used to decode ADS-B messages from a variety of sources, including software-defined radio devices. It is designed to be fast and efficient, making it suitable for real-time applications.

![The table view of `jet1090` in the terminal](../docs/screenshot/jet1090.png){#jet1090}

`jet1090` is comparable to the historical `dump1090` decoder (<https://github.com/antirez/dump1090>). However, it is designed to include additional features such as the ability to decode Mode S messages, the support for multiple input sources, and more output formats. The decoding logic is based on the Python decoder `pyModeS` [@sun_pymodes_2020] but adapted to Rust for performance reasons.

## planes

The `planes` module is a Python-based component that maintains a table of aircraft states. It is responsible for tracking the position and other parameters of aircraft in real time. The component uses the data provided by `jet1090` to update the state table and provide the frontend with real-time information about the aircraft.

A state vector table is a data structure (similar to what is displayed on \autoref{jet1090}) that contains the latest information about all the parameters of the aircraft. Such a data structure is necessary because different aircraft parameters are provided in different ADS-B messages. In particular, the position, the speed, the track angle, and the identification all come in different messages. Having the most recent information, along with all the possible features, is usually enough to display the aircraft on a map.

## trajectory

The `trajectory` module is a Python-based component that provides the history of data for a given aircraft. It is responsible for storing and retrieving historical data about the aircraft's position and other parameters. The component uses the data stored by the Redis system and reformats it to be used by the frontend in a more standard JSON-like format. This functionality is helpful in displaying the trajectory of an aircraft on a map and providing historical data for plotting, including altitude, speed, vertical rate, and other state information.

## tangram REST API

The core `tangram` component is a Python-based REST API that provides data retrieval and management capabilities. It is responsible for handling requests from the frontend and providing the necessary data for visualization and analysis. The API is designed to be modular and extensible, allowing the user to add their endpoints and functionality as needed.

Basic endpoints provided by the API include the data from `trajectory` and `planes`. Other endpoints are provided to facilitate the use of other data, such as meteorological data, through `fastmeteo` (<https://github.com/open-aviation/fastmeteo>). Since the component is based on FastAPI, it is also possible to dynamically add new endpoints to the API at the plugin level.

## channel

The `channel` (<https://github.com/emctoo/channel>) component is a Rust-based WebSocket connection that makes the bridge between the frontend and the Redis pub/sub system. It is responsible for providing real-time updates from and to the frontend.

For example, state vector updates from the `planes` component are published to a Redis pub/sub channel; the `channel` tool subscribes to this channel and forwards the updates to the frontend via a WebSocket. Conversely, information from the frontend, like the map's bounding box, is sent to the `channel` component, which then publishes it to another Redis pub/sub channel. For example, the `planes` component subscribes to this channel to update its state vector table based on the current map view.

# The plugin system in tangram

The tangram system is designed to be extensible. Users can easily implement particular functionalities by creating their plugins, either at the backend level, at the frontend level, or both.

A backend plugin is usually an executable or a Python module which can, for example:

- listen to a Redis channel;
- access private data or services requiring authentication;
- post-process and enrich data;
- share the resulting information on a Redis channel or REST endpoint.

A frontend plugin will usually be a Vue component, which can, for example:

- add HTML elements to the web application (in the navigation bar or the sidebar);
- capture user interactions (e.g., mouse clicks, keyboard events);
- send requests to the backend (e.g., through the REST API or WebSocket);
- display data on the map (e.g., by adding markers, drawing lines, etc.)

A few examples of plugins are already provided in the `tangram` repository, including a plugin for visualizing the location of Mode S receivers, including route information to an aircraft, or for visualizing wind fields at a given altitude.

# Potential applications

The tangram framework has been thought to display ADS-B data on a map, similarly to the OpenSky Network or FlightRadar24, and to enrich it to include extra visualization features based on algorithms published by the authors in the literature: turbulence detection [@olive_turbulence_2020], GNSS jamming detection [@felux_impacts_2024], anomaly detection [@zhao_incremental_2021], airspace occupancy metrics or aircraft trajectory prediction [@vos_transformer_2024].

The modularity of the framework allows for a wide range of other applications. The architecture and the frontend could be, for instance, extended to displaying ships broadcasting data on a similar protocol named AIS or serve as a basis for visualizing the output of real-time simulation tools, which are commonly advertised in the literature.

# Acknowledgement

This project has been funded by the Dutch Research Council (NWO) Open Science Fund OSF 23.1.051 <https://www.nwo.nl/en/projects/osf231051>

# References
