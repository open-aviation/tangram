# we no longer use process-compose. previous processes are now located under:
# - packages/tangram: `web`, `core/webapi`, `channel`
# - packages/tangram-jet1090: `planes`
# TODO: trajectory, history_redis

tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash
  set -x -euo pipefail
  cd web
  npx vite --host {{host}} --port {{port}}

# uv tool install "maturin[patchelf]"
install-dev:
  pnpm i
  pnpm build
  uv venv
  uvx maturin develop -m packages/tangram/rust/Cargo.toml --uv --release
  uvx maturin develop -m packages/tangram_jet1090/rust/Cargo.toml --uv --release
  uv pip install -e \
    packages/tangram_example \
    packages/tangram_history \
    packages/tangram_system \
    packages/tangram_weather

# TODO(abr): hot reload js frontend

create-tangram:
  podman build . --tag tangram:latest

docs-serve:
  uvx --with "mkdocs-material[imaging]" mkdocs serve

stubgen:
  cargo run --bin stub_gen_channel --features python
  cargo run --bin stub_gen_planes --features python

fmt:
  uv run ruff check packages --fix
  uv run ruff format packages