# WebSocket Channel in Rust


## Introduction

A Phoenix Channels implemented in Rust.

Quick start instructions (I use host network to make is easier):

```shell
# Launch redis
podman run -d --rm --name redis --network host docker.io/library/redis:8.0-M02

# Launch channel
podman pull ghcr.io/emctoo/channel:latest

# To get help information
podman run -it --rm --name channel -p 5000:5000 ghcr.io/emctoo/channel:latest

# run it
podman run -it --rm --name channel --network host \
  ghcr.io/emctoo/channel:latest \
  channel --redis-url redis://localhost:6379 --jwt-secret you-cant-see-me

# now open a browser and visit:
#   - http://localhost:5000?name=alice
#   - http://localhost:5000?name=bob
#   - http://localhost:5000/admin.html
```

## Test

```shell
cargo test
```
