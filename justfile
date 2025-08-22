# we no longer use process-compose.
# uvx tangram serve:
# - now has `web`, `core/webapi` in the main uvicorn/fastapi thread.
# - `channel` in the pyo3-wrapped service thread.


# in the future, we will have additional services:
# - tangram.planes
# - tangram.trajectory
# - tangram.history_redis


JET1090_VERSION := "0.4.8"
JET1090_IMAGE := "ghcr.io/xoolive/jet1090:" + JET1090_VERSION

tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash
  set -x -euo pipefail
  cd web
  npx vite --host {{host}} --port {{port}}

redis:
  podman container run -d --rm --name redis -p 127.0.0.1:6379:6379 docker.io/library/redis:8-alpine

jet1090:
  podman container run -it --rm --name jet1090 --network=host {{JET1090_IMAGE}} \
    --redis-url redis://127.0.0.1:6379 \
    --jet1090-channel jet1090 \
    ws://feedme.mode-s.org:9876/40128@EHRD

docs-serve:
  uvx --with "mkdocs-material[imaging]" mkdocs serve
