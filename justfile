# we no longer use process-compose. previous processes are now located under:
# - packages/tangram: `web`, `core/webapi`, `channel`
# - packages/tangram-jet1090: `planes`
# TODO: trajectory

tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash
  set -x -euo pipefail
  cd web
  npx vite --host {{host}} --port {{port}}

setup-dev:
  pnpm i
  pnpm build
  uv venv
  uv sync --all-groups --all-packages
  # TODO: git cleaning and running this again fails because uv cache doesn't understand cdylib is gone

# TODO(abr): hot reload js frontend

podman-redis:
  podman run -d --rm -p 6379:6379 --name redis redis:latest

podman-jet1090:
  podman run -d --rm --name jet1090 \
    --network=host \
    ghcr.io/xoolive/jet1090:latest \
    jet1090 --redis-url "redis://127.0.0.1:6379" "ws://feedme.mode-s.org:9876/40128@EHRD"

# build tangram with podman.
# on non x86_64 architectures, set eccodes_strategy to `fromsource`.
podman-tangram-build eccodes_strategy='prebuilt':
  podman build . \
    --build-arg ECCODES_STRATEGY={{eccodes_strategy}} \
    --tag tangram:latest

podman-tangram:
  podman run -d --rm --name tangram \
    -p 8000:8000 \
    -v ./tangram.example.toml:/app/tangram.toml \
    --network=host \
    localhost/tangram:latest \
    tangram serve --config /app/tangram.toml

docs-serve:
  uvx --with "mkdocs-material[imaging]" mkdocs serve

stubgen:
  cargo run --bin stub_gen_channel --features python
  cargo run --bin stub_gen_planes --features python

fmt:
  uv run ruff check packages --fix
  uv run ruff format packages
  pnpm fmt

_podman-rmi name:
  podman images --filter "reference={{name}}" -q | xargs -r podman rmi --force

# nukes tangram and its build cache, keeping redis and jet1090 intact, be careful!!
_clean:
  git clean -Xdf
  podman kill tangram || true
  just _podman-rmi tangram
  podman system prune --all --volumes --force
  podman system prune --external --force
  podman container rm \
    --force \
    --depend='1' \
    --volumes='1' \
    $(podman container list \
        --external='1' \
        --filter='status=created' \
        --filter='status=exited' \
        --filter='status=paused' \
        --filter='status=unknown' \
        --no-trunc='1' \
        --quiet='1' \
    ) || true