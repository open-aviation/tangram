# to use docker, install `docker-buildx` and run:
# `export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 CONTAINER_RUNTIME=docker`
container_runtime := env("CONTAINER_RUNTIME", "podman")

# TODO: git cleaning and running this again fails because uv cache doesn't understand cdylib is gone
# TODO(abr): hot reload js frontend
install:
  pnpm i
  pnpm build
  uv sync --all-groups --all-packages

# NOTE: the following `c-` commands are for temporary testing with hardcoded ports.
# a future version of tangram will manage them properly.
# TODO: migrate to podman networks

c-redis:
  {{container_runtime}} run -d --rm -p 6379:6379 --name redis redis:latest

jet1090_sources := '"ws://feedme.mode-s.org:9876/40128@EHRD"'

c-jet1090 sources=jet1090_sources:
  {{container_runtime}} run -d --rm --name jet1090 \
    --network=host \
    ghcr.io/xoolive/jet1090:latest \
    jet1090 --serve-port 8080 --history-expire 5 --redis-url "redis://127.0.0.1:6379" {{sources}}

# before running this, clone the repo and `cargo install --path crates/ship162`
ship162:
  ship162 --redis-url "redis://127.0.0.1:6379" tcp://153.44.253.27:5631

# build tangram with your container runtime.
# on non x86_64 architectures, set eccodes_strategy to `fromsource`.
c-build eccodes_strategy='prebuilt':
  {{container_runtime}} build . \
    --build-arg ECCODES_STRATEGY={{eccodes_strategy}} \
    --tag tangram:latest \
    -f Containerfile

c-run:
  {{container_runtime}} run -d --rm --name tangram \
    -p 2346:2346 \
    -v ./tangram.example.toml:/app/tangram.toml \
    --network=host \
    localhost/tangram:latest \
    tangram serve --config /app/tangram.toml

stubgen:
  cargo run --package tangram_core --bin stub_gen_core --features pyo3,stubgen || true
  cargo run --package jet1090_planes --bin stub_gen_planes --features pyo3,stubgen || true
  cargo run --package ship162_ships --bin stub_gen_ships --features pyo3,stubgen || true
  cargo run --package tangram_history --bin stub_gen_history --features pyo3,stubgen || true

# fix code quality (eslint, ruff, clippy) and formatting (prettier, ruff, rustfmt)
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