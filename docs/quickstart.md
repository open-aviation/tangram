# Tangram Quick Start Guide

This guide will help you set up and run Tangram for real-time aviation data visualization.

## Prerequisites

Before you begin, ensure you have the following tools installed:

1. [just](https://github.com/casey/just) - A command project-specific runner
2. [podman](https://podman.io/docs/installation) - A container runtime

## Setup and Configuration

### 1. Environment Configuration

Create an environment file from the template:

```shell
cp .env.example .env
```

### 2. Launch Redis

Start a Redis container for message caching between different services:

```shell
just redis
```

### 3. Build Containers

Build the `tangram` and `jet1090` containers:

```shell
just build
just build-jet1090
```

### 4. Configure and Run Data Source

Set up the data source parameters and run the `jet1090` container:

```shell
# Configure your data source, for example:
JET1090_PARAMS=ws://feedme.mode-s.org:9876/40128@EHRD

# Run the data receiver
just jet1090
```

You should now see the `jet1090` console displaying data received from the source:

![jet1090 console](./web/screenshot/jet1090.png)

### 5. Launch Tangram

In a new terminal, run the Tangram container:

```shell
just run
```

The process composer console will show the various background processes:

![process composer](./web/screenshot/process.png)

### 6. Access the Visualization Interface

Open your browser and navigate to:

```
http://localhost:2024
```

You'll see the Tangram web interface displaying real-time aviation data:

![web interface](./web/screenshot/web.png)

## Troubleshooting

If you encounter issues:

1. Check the logs with:
   ```shell
   just log tangram
   ```

2. Ensure all containers are running:
   ```shell
   podman container ls
   ```

3. Verify Redis connection:
   ```shell
   podman container exec -it redis redis-cli ping
   ```

## Advanced Configuration

For advanced configuration options, please refer to the `.env.example` file and the detailed documentation in the `docs` directory.