# adapted from: https://pnpm.io/podman
FROM node:24-slim AS frontend-builder
WORKDIR /app

RUN corepack enable

VOLUME [ "/pnpm-store", "/app/node_modules" ]
RUN pnpm config --global set store-dir /pnpm-store

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY packages .

RUN pnpm install
RUN pnpm run build

# adapted from https://github.com/astral-sh/uv-docker-example/blob/main/multistage.Dockerfile
# not using --locked
FROM ghcr.io/astral-sh/uv:0.8.13-python3.13-trixie-slim AS wheel-builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev
# TODO: figure out how to select what to install (from tangram toml)
COPY --from=frontend-builder /app .
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev

FROM python:3.13-slim-trixie
COPY --from=wheel-builder /app /app
ENV PATH="/app/.venv/bin:$PATH"

CMD ["tangram", "serve"]