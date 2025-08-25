ARG PYTHON_VERSION=3.13
# since we use a workspace, we need to copy package.json under all subdirectories
# but the `COPY --exclude` syntax requires dockerfile:1.7-labs, i.e.
# buildah>=v1.38.0 (2024-11-08) or podman>=5.3
# but the default ubuntu 24.04 sources only has podman==4.9.3...
# see: https://github.com/pnpm/pnpm/issues/3114#issuecomment-2195062068
# so we just list them out explicitly
FROM scratch AS frontend-package-jsons
COPY packages/tangram/package.json /f/packages/tangram/
COPY packages/tangram_example/package.json /f/packages/tangram_example/
COPY packages/tangram_jet1090/package.json /f/packages/tangram_jet1090/
COPY packages/tangram_system/package.json /f/packages/tangram_system/
COPY packages/tangram_weather/package.json /f/packages/tangram_weather/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /f/
FROM node:24-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=frontend-package-jsons /f .
RUN --mount=type=cache,target=/root/.local/share/pnpm pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm build

# tangram_weather > cfgrib > eccodes is problematic:
# 1. eccodes>=2.39 no longer provides wheels: https://github.com/ecmwf/eccodes-python/issues/121
# 2. eccodes>=2.43 is now a wrapper over eccodeslib, and it doesn't provide musllinux or aarch64
#    wheels either: https://github.com/ecmwf/eccodes-python/issues/107
# so we must build from scratch

# TODO: for manylinux_2_28, disable it
FROM python:${PYTHON_VERSION}-slim-trixie AS eccodes-builder
ARG ECCODES_VERSION=2.42.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    gfortran \
    libopenjp2-7-dev \
    libaec-dev \
    libpng-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN wget https://confluence.ecmwf.int/download/attachments/45757960/eccodes-${ECCODES_VERSION}-Source.tar.gz -O eccodes-src.tar.gz \
    && tar -xzf eccodes-src.tar.gz \
    && mv eccodes-${ECCODES_VERSION}-Source eccodes-src

# we will install python bindings later (via tangram_weather) so we disable python
RUN mkdir eccodes-build && cd eccodes-build \
    && cmake ../eccodes-src \
        -DCMAKE_INSTALL_PREFIX=/opt/eccodes \
        -DENABLE_PYTHON=OFF \
        -DENABLE_FORTRAN=ON \
    && make -j$(nproc) \
    && make install

# adapted from https://github.com/astral-sh/uv-docker-example/blob/main/multistage.Dockerfile
# --locked tries to ensure uv.lock is updated, which is annoying, using --frozen instead
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-trixie-slim AS wheel-builder

ARG RUST_VERSION=stable

# install rust so maturin doesn't try to reinstall it
# we also need:
# - tangram > channel > httparse: `cc`
# - tangram > channel > openssl-sys: `pkg-config` and `libssl-dev`
# - tangram_weather > eccodeslib: runtime deps
# runtime dependencies of compiled C library
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenjp2-7 \
    libaec0 \
    libpng16-16 \
    curl \
    build-essential \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y \
        --default-toolchain $RUST_VERSION \
        --profile minimal

ENV PATH="/root/.cargo/bin:${PATH}"
COPY --from=eccodes-builder /opt/eccodes /opt/eccodes
ENV LD_LIBRARY_PATH=/opt/eccodes/lib:$LD_LIBRARY_PATH
ENV ECCODES_DEFINITION_PATH=/opt/eccodes/share/eccodes/definitions

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace --no-dev
# NOTE: the goal is being able to specify a tangram.toml and build an image with
# any additional (possibly out-of-tree) plugins, but right now we sync
# *everything* in this tree.
COPY --from=frontend-builder /app .
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --all-packages

# RUN uv run -m eccodes selfcheck
FROM python:${PYTHON_VERSION}-slim-trixie
COPY --from=wheel-builder /app /app
ENV PATH="/app/.venv/bin:$PATH"

CMD ["tangram"]