# to use docker, install `docker-buildx` and run:
# `export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 CONTAINER_RUNTIME=docker`
container_runtime := env("CONTAINER_RUNTIME", "podman")

# Install the project in development mode.
install:
  # NOTE: git cleaning and running this again fails because uv cache doesn't understand the .so is gone
  # see: https://github.com/astral-sh/uv/issues/11390#issuecomment-3436401449
  pnpm i
  pnpm build
  uv sync --all-groups --all-extras --all-packages

#
# External dependencies
#

# NOTE: the following `c-` commands are for temporary testing with hardcoded ports.
# a future version of tangram will use podman networks properly.

# Launch redis in a container.
c-redis:
  #!/usr/bin/env bash
  if {{container_runtime}} container exists redis; then
    echo "container redis exists"
    exit 0
  fi

  {{container_runtime}} run -d --rm -p 6379:6379 --name redis docker.io/library/redis:latest

jet1090_sources := '"ws://feedme.mode-s.org:9876/40128@EHRD"'

# Launch `jet1090` for the `tangram_jet1090` plugin in a container.
c-jet1090 sources=jet1090_sources:
  {{container_runtime}} run -d --rm --name jet1090 \
    --network=host \
    ghcr.io/xoolive/jet1090:latest \
    jet1090 --serve-port 8080 --history-expire 5 --redis-url "redis://127.0.0.1:6379" {{sources}}

# Launch `ship162` for the `tangram_ship162` plugin locally.
# Make sure you have cloned https://github.com/xoolive/ship162 and ran `cargo install --path crates/ship162`
ship162:
  ship162 --redis-url "redis://127.0.0.1:6379" tcp://153.44.253.27:5631

#
# Build tangram in podman (experimental)
#

# Build tangram with all plugins in a container.
# For non x86_64 architectures, set eccodes_strategy to `fromsource`.
c-build eccodes_strategy='prebuilt':
  {{container_runtime}} build . \
    --build-arg ECCODES_STRATEGY={{eccodes_strategy}} \
    --tag tangram:latest \
    -f Containerfile

# Run tangram with all plugins in a container.
c-run path_config='./tangram.example.toml':
  {{container_runtime}} run -d --rm --name tangram \
    -p 2346:2346 \
    -v {{path_config}}:/app/tangram.toml \
    --network=host \
    localhost/tangram:latest \
    tangram serve --config /app/tangram.toml

#
# Misc development utilities
#

# Regenerate `.pyi` stub files from PyO3 native introspection.
stubgen:
  @tmp=$(mktemp -d); pyo3i=$(find ~/.cargo/registry/src -path '*/pyo3-introspection-*/Cargo.toml' | sort -V | tail -1); trap 'rm -rf "$tmp"' EXIT; \
    cargo build -p tangram_core_rs --features pyo3; cargo run --manifest-path "$pyo3i" -- target/debug/libtangram_core.so _core "$tmp/core"; cp "$tmp/core/__init__.pyi" packages/tangram_core/src/tangram_core/_core.pyi; \
    cargo build -p tangram_datalink --features pyo3; cargo run --manifest-path "$pyo3i" -- target/debug/lib_datalink.so _datalink "$tmp/datalink"; cp "$tmp/datalink/__init__.pyi" packages/tangram_datalink/src/tangram_datalink/_datalink.pyi; \
    cargo build -p tangram_history --features stubgen; cargo run --manifest-path "$pyo3i" -- target/debug/libtangram_history.so _history "$tmp/history"; cp "$tmp/history/__init__.pyi" packages/tangram_history/src/tangram_history/_history.pyi; \
    cargo build -p tangram_jet1090 --features pyo3; cargo run --manifest-path "$pyo3i" -- target/debug/lib_planes.so _planes "$tmp/planes"; cp "$tmp/planes/__init__.pyi" packages/tangram_jet1090/src/tangram_jet1090/_planes.pyi; \
    cargo build -p tangram_ship162 --features pyo3; cargo run --manifest-path "$pyo3i" -- target/debug/lib_ships.so _ships "$tmp/ships"; cp "$tmp/ships/__init__.pyi" packages/tangram_ship162/src/tangram_ship162/_ships.pyi

# Check code quality (eslint, ruff, clippy) and formatting (prettier, ruff, rustfmt).
check:
  uv run ruff check packages
  uv run ruff format packages --check
  pnpm typecheck
  pnpm typecheck:vite
  cargo check --all-targets --all-features
  cargo fmt --all -- --check
  cargo clippy --all-targets --all-features -- -D warnings

# Fix code quality (eslint, ruff, clippy) and formatting (prettier, ruff, rustfmt).
fmt:
  uv run ruff check packages --fix || true
  uv run ruff format packages || true
  pnpm i || true
  pnpm fmt || true
  pnpm lint || true
  cargo fmt --all || true
  cargo clippy --all-targets --fix --allow-dirty --allow-staged --all-features || true

_rmi name:
  {{container_runtime}} images --filter "reference={{name}}" -q | xargs -r {{container_runtime}} rmi --force

# nukes tangram and its build cache, keeping redis and jet1090 intact
# removes virtually ALL non-running containers, images and build cache, be careful!!
_clean:
  git clean -Xdf
  {{container_runtime}} kill tangram || true
  just _rmi tangram
  {{container_runtime}} system prune --all --volumes --force
  {{container_runtime}} system prune --external --force
  {{container_runtime}} container rm \
    --force \
    --depend='1' \
    --volumes='1' \
    $({{container_runtime}} container list \
        --external='1' \
        --filter='status=created' \
        --filter='status=exited' \
        --filter='status=paused' \
        --filter='status=unknown' \
        --no-trunc='1' \
        --quiet='1' \
    ) || true

docs:
  uv run --no-default-groups --group docs zensical serve