# Tangram Data Flow: From Source to Visualization

This document describes the data flow in Tangram, starting from the data source (jet1090) through processing and filtering, and ultimately to visualization in the frontend.

## Complete Data Flow Diagram

```
┌─────────────┐    JSONL     ┌─────────────┐    JSON      ┌─────────────┐
│             │  (stdout)    │             │  (Redis)     │             │
│   jet1090   ├──────────────►  line-filter├──────────────►   Redis     │
│             │              │             │              │             │
└─────────────┘              └─────────────┘              └─────┬───────┘
                                                                │
                                                                │
                                                                ▼
┌─────────────┐              ┌─────────────┐              ┌─────────────┐
│             │    JSON      │             │    JSON      │             │
│  Frontend   ◄──────────────┤  WebSocket  ◄──────────────┤   Backend   │
│  (Browser)  │  (WebSocket) │   Server    │  (Subscribe) │   Plugins   │
│             │              │             │              │             │
└─────────────┘              └─────────────┘              └─────────────┘
```

## [Data source: jet1090](./data-source.md)

## Redis as Message Broker

Redis serves as the central message broker in Tangram's architecture, providing:

1. **Pub/Sub Capability**: Enables efficient distribution of filtered messages to multiple subscribers
2. **Decoupling**: Separates data producers from consumers
3. **Buffering**: Handles temporary processing speed mismatches between components
4. **Scaling**: Allows multiple instances of components to process the same data

### Key Redis Topics

The filtered data is published to several Redis topics:

- `jet1090-full`: Raw, unfiltered data (used rarely due to volume), you can specify in `jet1090` config.
- `coordinate`: Messages containing position data (latitude, longitude, altitude), published by `line-filter`.
- Other specialized topics for specific analysis needs

## Backend Processing

Once published to Redis, the data is processed by various backend plugins:

1. **Streaming Plugin**: Subscribes to Redis topics and forwards data to connected WebSocket clients
2. **History Plugin**: Stores selected data points for historical analysis
3. **Analysis Plugins**: Perform specialized calculations (e.g., turbulence detection)
4. **Rate Limiting Plugin**: Provides additional control over data flow rates

These plugins operate as independent Python processes, each subscribing to relevant Redis topics according to their specific needs.

## Frontend Visualization

The frontend receives data through WebSocket connections established with the backend streaming service. Each visualization plugin subscribes to specific data types:

- Map displays subscribe to coordinate data
- Timeline visualizations subscribe to temporal events
- Specialized visualizations subscribe to analysis results


## Performance Considerations

The filtering approach using line-filter provides several performance benefits:

1. **Early Filtering**: Reduces data volume at the earliest possible stage
2. **Language Choice**: Rust provides high-performance text processing with low overhead
3. **Minimal Parsing**: Simple text matching avoids full JSON parsing overhead
4. **Rate Limiting**: Built-in rate limiting prevents overwhelming downstream components
5. **Pipeline Design**: Standard Unix pipeline pattern allows efficient data flow

This design allows Tangram to handle high-volume surveillance data streams while maintaining responsive real-time visualization.

## Configuration

The data flow can be configured through several mechanisms:

1. **jet1090 Configuration**: Controls data source parameters
2. **line-filter Rules**: Define which data is published to which topics
3. **Redis Configuration**: Controls message broker behavior. It's usable out of box.
4. **Backend Plugin Settings**: Determine processing parameters
5. **Frontend Subscription Settings**: Control which data is visualized

These configuration options allow Tangram to be adapted to different surveillance data sources and analysis needs.