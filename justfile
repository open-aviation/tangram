# we no longer use process-compose.
# uvx tangram serve:
# - now has `web`, `core/webapi` in the main uvicorn/fastapi thread.
# - `channel` in the pyo3-wrapped service thread.


# in the future, we will have additional services:
# - tangram.planes
# - tangram.trajectory
# - tangram.history_redis

tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash
  set -x -euo pipefail
  cd web
  npx vite --host {{host}} --port {{port}}

create-tangram:
  podman build . --tag tangram:latest

docs-serve:
  uvx --with "mkdocs-material[imaging]" mkdocs serve


stubgen:
  cargo run --bin stub_gen_channel --features python
  cargo run --bin stub_gen_planes --features python
  