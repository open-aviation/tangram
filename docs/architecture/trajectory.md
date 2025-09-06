# trajectory

## Overview

`trajectory` is a component designed to monitor aircraft traffic, reconstruct historical data, and provide structured access to this information.
While `planes` focuses on real-time tracking and state vector updates, `trajectory` builds on this by storing and serving historical data, allowing users to query past aircraft movements and trajectories.

## Key features

- Trajectory reconstruction: Building complete flight paths from sequential messages
- Historical data storage: Maintaining a searchable database (in Redis) of past aircraft states
- REST API access: Providing standardized interfaces to query aircraft data

## Testing

There is no dedicated test suite for `trajectory` at the moment. However, you can verify its functionality by running the full tangram stack and checking if historical data is being stored and can be queried via the API. The most direct check is to click on an aircraft in the tangram web interface and see if its past trajectory is displayed.
