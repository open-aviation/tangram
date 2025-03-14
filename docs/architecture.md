# Tangram Architecture

Tangram is designed with a modular, plugin-based architecture that enables flexible development and extension. This document outlines the core components of the system and how they interact.

## System Overview

![Tangram Architecture Overview](architecture-diagram.png)

Tangram consists of several key components:

1. **Frontend**: A Vue.js-based web application
2. **Backend Service**: A Python FastAPI web service
3. **Channel**: A Rust-based WebSocket streaming service
4. **Backend Plugins**: Individual Python processes for data processing
5. **Data Source**: jet1090 container for ADS-B/Mode S data reception

All these components (except the data source) run within a single container orchestrated by `process-compose`.

## Component Details

### Frontend

The frontend is built with Vue.js and provides a dynamic, real-time visualization interface for aviation data. Key features include:

- Plugin-based architecture for extending visualization capabilities
- Component-based design for reusable UI elements
- WebSocket connection for real-time data updates
- RESTful API integration for configuration and historical data

#### Frontend Plugin System

Developers can create custom visualization plugins that integrate seamlessly with the main application.

Each plugin follows a standard interface that allows it to:
- Register with the main application
- Subscribe to relevant data streams
- Render visualization components
- Interact with other plugins

### Channel (Streaming Service)

The Channel component is a high-performance Rust implementation that handles real-time data streaming:

- WebSocket server for frontend connections
- Integration with Redis for pub/sub messaging
- Efficient data serialization and transmission
- Connection management and error handling

This component enables the real-time nature of Tangram, allowing for immediate visualization of incoming aviation data.

### Backend Service (TODO: we can move this into a plugin now)

The backend service is built with Python using FastAPI. It provides:

- RESTful API endpoints for configuration and data retrieval
- Database interactions for historical data
- Authentication and authorization services
- Plugin management and coordination

The service acts as the central coordinator for the system, managing communications between the frontend and various data processing plugins.

### Backend Plugins

Backend functionality is extended through a plugin system, where each plugin is an independent Python process:

- **Web Service Plugins**: Extend the API with new endpoints
- **Streaming Source Plugins**: Connect to external data sources
- **Streaming Handler Plugins**: Process incoming data streams
- **Analyzer Plugins**: Perform computations on the data

Examples of backend plugins include:
- History plugin for storing and retrieving historical data
- Rate limiting plugin for controlling data flow
- Filtering plugin for focusing on specific data points
- Analysis plugins for specialized calculations (e.g., turbulence detection)

Each plugin follows a standard interface but operates as an independent process, allowing for isolation and scalability.

### Process Management

All components (except the data source) run within a single container managed by `process-compose`, which:
- Handles process startup and shutdown
- Manages dependencies between processes
- Provides process monitoring and logging
- Enables configuration through environment variables

This architecture is defined in `container/process-compose.yaml` and can be extended to include additional plugins.

### Data Source (jet1090)

The aviation data comes from `jet1090`, which runs in a separate container:
- Receives ADS-B and Mode S data from various sources
- Decodes and normalizes the data
- Publishes data to Redis topics
- Provides a WebSocket interface for direct connections

The separation of the data source allows it to be replaced or modified independently of the rest of the system.

## Data Flow

1. `jet1090` receives aviation surveillance data
2. Data is published to Redis topics
3. Backend plugins subscribe to relevant topics and process the data
4. Processed data is published to new Redis topics
5. The Channel component streams data to connected frontend clients
6. Frontend plugins visualize the data in real-time

## Progressive Development Approach

Tangram's architecture supports a progressive development approach:

1. **Basic API Integration**: Developers can start by using the RESTful API endpoints to retrieve and visualize data at regular intervals.

2. **Enhanced Processing**: As familiarity grows, developers can create backend plugins to process the data according to their specific needs.

3. **Real-time Streaming**: Finally, developers can leverage the full WebSocket capabilities to create truly real-time visualizations.

This progression allows developers to start with familiar concepts and gradually adopt more advanced techniques as their requirements evolve.

## Containerization

The entire system is containerized for easy deployment:

- `tangram.Containerfile`: Defines the main container with all components
- `jet1090.Dockerfile`: Defines the data source container
- `justfile`: Provides convenient commands for building and running the containers

The containerization ensures consistency across different environments and simplifies the deployment process.

## Extension Points

Tangram is designed to be extended in several ways:

1. **Frontend Plugins**: Add new visualization components
2. **Backend Plugins**: Add new data processing capabilities
3. **Data Sources**: Connect to different surveillance data providers
4. **Analysis Algorithms**: Implement custom algorithms for data analysis

These extension points allow Tangram to be adapted to a wide range of aviation data visualization and analysis needs.