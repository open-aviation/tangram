# Quick start 

I use host network to make is easier.

```shell
# Launch redis
podman run -d --rm --name redis --network host docker.io/library/redis:8.0-M02

# Launch channel
podman pull ghcr.io/emctoo/channel:latest

# To get help information
podman run -it --rm --name channel -p 2025:2025 ghcr.io/emctoo/channel:latest

# run it
podman run -it --rm --name channel --network host \
  ghcr.io/emctoo/channel:latest \
  channel --redis-url redis://localhost:6379 --jwt-secret you-cant-see-me

# now open a browser and visit:
#   - http://localhost:2025?name=alice
#   - http://localhost:2025?name=bob
#   - http://localhost:2025/admin.html
```