# Tangram: Progressive Aviation Data Visualization

Tangram is an open framework that aggregates and processes ADS-B and Mode S surveillance data for real-time analysis. The system provides a flexible plugin architecture where users can easily implement custom analyzers for their specific needs.

## Overview

Tangram's architecture consists of a Vue based frontend, a service backend and a streaming service backend. The backend efficiently aggregates data from multiple receiver streams and exposes a WebSocket interface, enabling real-time data visualization and analysis in the browser-based frontend.

## Progressive Development Approach

One of Tangram's key strengths is its progressive approach to aviation data visualization. This means you can start with familiar API-based methods and gradually evolve your implementation into a real-time visualization system:

### Traditional API Integration

Begin with standard REST API calls to fetch historical or static aviation data. This familiar approach allows you to build basic visualizations with data refreshed at set intervals.

### Enhanced Data Processing

Implement custom analyzers and visualization using Tangram's plugin architecture. This stage enables more sophisticated data processing while still using conventional data flow patterns.

### Stage 3: Real-time Streaming

Transition to WebSocket connections for true real-time data visualization. This advanced stage leverages Tangram's full capabilities for live surveillance data monitoring and analysis.

This progressive approach allows developers to:
- Start with familiar concepts and gradually adopt more advanced techniques
- Build and test incrementally
- Adopt real-time capabilities at their own pace
- Maintain backward compatibility with existing systems

## Getting Started

To start working with Tangram, please refer to our [Quick Start Guide](quickstart.md) for detailed installation and setup instructions.

Once set up, you can access the visualization interface at http://localhost:2024 to see real-time aviation data visualization in action.
