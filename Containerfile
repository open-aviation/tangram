# this containerfile only builds the core along with hardcoded list of in-tree plugins
# TODO: in the future, support parsing `tangram.toml`

ARG PYTHON_VERSION=3.13
# tangram_weather > cfgrib > eccodes is problematic:
# - eccodes>=2.39 no longer provides prebuilt wheels: https://github.com/ecmwf/eccodes-python/issues/121
# - eccodes>=2.43 now wraps over eccodeslib, but it doesn't provide musllinux or aarch64 wheels
# ECCODES_STRATEGY should be set to `prebuilt` on x86_64 and `fromsource` on aarch64.
ARG ECCODES_STRATEGY=prebuilt

# NOTE: unfortunately the `COPY --exclude` syntax requires podman>=5.3 and is only available in
# ubuntu 25.04, so we just list them out explicitly (for now)
FROM scratch AS frontend-package-jsons
COPY packages/tangram/package.json /packages/tangram/
COPY packages/tangram_example/package.json /packages/tangram_example/
COPY packages/tangram_jet1090/package.json /packages/tangram_jet1090/
COPY packages/tangram_system/package.json /packages/tangram_system/
COPY packages/tangram_weather/package.json /packages/tangram_weather/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /
FROM node:24-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=frontend-package-jsons / .
RUN --mount=type=cache,target=/root/.local/share/pnpm pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm build

FROM python:${PYTHON_VERSION}-slim-trixie AS eccodes-builder
ARG ECCODES_VERSION=2.42.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake gfortran \
    libopenjp2-7-dev libaec-dev libpng-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN wget https://confluence.ecmwf.int/download/attachments/45757960/eccodes-${ECCODES_VERSION}-Source.tar.gz -O eccodes-src.tar.gz \
    && tar -xzf eccodes-src.tar.gz \
    && mv eccodes-${ECCODES_VERSION}-Source eccodes-src \
    && wget https://github.com/ecmwf/eccodes-python/archive/refs/tags/${ECCODES_VERSION}.tar.gz -O eccodes-python.tar.gz \
    && tar -xzf eccodes-python.tar.gz \
    && mv eccodes-python-${ECCODES_VERSION} /opt/eccodes-python

RUN mkdir eccodes-build && cd eccodes-build \
    && cmake ../eccodes-src \
        -DCMAKE_INSTALL_PREFIX=/opt/eccodes \
        -DENABLE_PYTHON=OFF \
        -DENABLE_FORTRAN=ON \
    && make -j$(nproc) \
    && make install

FROM python:${PYTHON_VERSION}-slim-trixie AS python-builder-base
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ARG RUST_VERSION=stable
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    # tangram > channel > httpparse
    build-essential \
    # tangram_jet1090 > aircraftdb > reqwest > openssl-sys
    libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y \
        --default-toolchain $RUST_VERSION \
        --profile minimal

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

FROM python-builder-base AS python-builder-eccodes-fromsource
COPY --from=eccodes-builder /opt /opt
ENV ECCODES_DIR=/opt/eccodes
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv venv \
    && uv pip install "/opt/eccodes-python/." \
    # not using --locked because it tries to validate that the lockfile is up to date
    && uv sync --no-install-workspace --frozen --no-dev --all-packages --inexact \
        --no-install-package eccodes \
        --no-install-package eccodeslib \
        --no-install-package eckitlib \
        --no-install-package fckitlib

COPY --from=frontend-builder /app .
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --all-packages --inexact \
        --no-install-package eccodes \
        --no-install-package eccodeslib \
        --no-install-package eckitlib \
        --no-install-package fckitlib

FROM python-builder-base AS python-builder-eccodes-prebuilt
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv venv \
    && uv sync --no-install-workspace --frozen --no-dev --all-packages --inexact
COPY --from=frontend-builder /app .
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --all-packages --inexact

FROM python:${PYTHON_VERSION}-slim-trixie AS release-eccodes-fromsource
RUN apt-get update && apt-get install -y --no-install-recommends \
    # libeccodes runtime deps
    libopenjp2-7 libaec0 libpng16-16 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=python-builder-eccodes-fromsource /app /app
COPY --from=eccodes-builder /opt /opt
ENV ECCODES_DIR=/opt/eccodes
ENV PATH="/app/.venv/bin:$PATH"
RUN python3 -m eccodes selfcheck
CMD ["tangram"]

FROM python:${PYTHON_VERSION}-slim-trixie AS release-eccodes-prebuilt
RUN apt-get update && apt-get install -y --no-install-recommends \
    # libeccodes runtime deps
    libopenjp2-7 libaec0 libpng16-16 libeccodes0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=python-builder-eccodes-prebuilt /app /app
ENV PATH="/app/.venv/bin:$PATH"
RUN python3 -m eccodes selfcheck
CMD ["tangram"]

FROM release-eccodes-${ECCODES_STRATEGY}