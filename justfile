# we no longer use process-compose. previous processes are now located under:
# - packages/tangram: `web`, `core/webapi`, `channel`
# - packages/tangram-jet1090: `planes`
# TODO: trajectory

tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash
  set -x -euo pipefail
  cd web
  npx vite --host {{host}} --port {{port}}

# TODO: check difference against
# uvx maturin develop -m packages/{}/rust/Cargo.toml --uv --release
# uv pip install -e packages/{}
# e.g. does it do patchelf? what about debug symbols?
# TODO: git cleaning and running `setup-dev` fails (uv cache doesn't understand cdylib is gone)

setup-dev:
  pnpm i
  pnpm build
  uv venv
  uv sync --all-groups --all-packages

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
  pnpm fmt

# nukes everything, be careful!!
_clean:
  git clean -Xdf
  podman system prune --all --force
  podman rmi --all --force