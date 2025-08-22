# trajectory

## Overview

`trajectory` is a component designed to monitor aircraft traffic, reconstruct historical data, and provide structured access to this information.
While `planes` focuses on real-time tracking and state vector updates, `trajectory` builds on this by storing and serving historical data, allowing users to query past aircraft movements and trajectories.

## Key features

- Trajectory reconstruction: Building complete flight paths from sequential messages
- Historical data storage: Maintaining a searchable database (in Redis) of past aircraft states
- REST API access: Providing standardized interfaces to query aircraft data
