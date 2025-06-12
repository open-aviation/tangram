# Stage 1: Build the Rust binary
FROM docker.io/library/rust:1.85-slim as builder

# Install required dependencies for Rust build
COPY ./container/add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN chmod +x /usr/local/bin/add-apt-proxy.sh
RUN /usr/local/bin/add-apt-proxy.sh

RUN apt-get update \
  && apt-get install -y --no-install-recommends git pkg-config libssl-dev \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

  # Create a new user to match the one in the final image
RUN useradd -m -s /bin/bash user

# Create directory structure
WORKDIR /home/user/tangram/crates/planes

# Copy only the files needed for building the Rust binary
COPY crates/planes/Cargo.toml ./
COPY crates/planes/Cargo.lock ./
COPY crates/planes/src ./src/

# Build the Rust binary
RUN cargo build --release

# Stage 1 bis: Build the eccodes environment
FROM python:3.13-slim as eccodes_builder

RUN apt-get update && apt-get install -y \
    wget cmake build-essential \
    libaec-dev
    # zlib1g-dev libbz2-dev libpng-dev

# Install Python wheel building dependencies
RUN pip install --no-cache-dir setuptools wheel build

ENV ECCODES_VERSION=2.41.0
WORKDIR /build

# Download and extract eccodes source
RUN wget https://confluence.ecmwf.int/download/attachments/45757960/eccodes-$ECCODES_VERSION-Source.tar.gz?api=v2 -O eccodes-$ECCODES_VERSION-Source.tar.gz \
    && tar -xzf eccodes-$ECCODES_VERSION-Source.tar.gz \
    && rm eccodes-$ECCODES_VERSION-Source.tar.gz

# Build eccodes libraries
RUN mkdir -p eccodes-build \
    && cd eccodes-build \
    && cmake ../eccodes-$ECCODES_VERSION-Source -DCMAKE_INSTALL_PREFIX=/usr/local -DENABLE_FORTRAN=0 \
    && make -j$(nproc) \
    && make install

# RUN apt-get install -y git
# # Clone and build eccodes-python wheel
# WORKDIR /build
# RUN git clone https://github.com/ecmwf/eccodes-python \
#     && cd eccodes-python \
#     && python -m build --wheel
#
# # The wheel file will be in /build/eccodes-python/dist/
# WORKDIR /build/eccodes-python/dist
#
# # Test the built wheel
# RUN pip install eccodes-*.whl \
#     && python -m eccodes selfcheck

# Stage 2: The main image
FROM python:3.13-slim

# this image is debian based, configure apt proxy if available
COPY ./container/add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN chmod +x /usr/local/bin/add-apt-proxy.sh
RUN /usr/local/bin/add-apt-proxy.sh

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq git unzip xz-utils \
  libaec-dev \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user

# it's copied here, because tangram is specified as editable in lock file
# meanwhile, it's mounted as a volume when we run the container in development
COPY justfile .
COPY .env .

# Copy the compiled binary from the builder stage
COPY --from=builder /home/user/tangram/crates/planes/target/release/planes /usr/bin/planes

COPY --from=eccodes_builder /usr/local/lib/libeccodes.so* /usr/local/lib/
COPY --from=eccodes_builder /usr/local/share/eccodes /usr/local/share/eccodes

RUN chmod +x /usr/bin/planes

USER user

ENV PATH=/home/user/.local/bin:$PATH
ENV PATH=/home/user/.cargo/bin:$PATH

RUN mkdir -p /home/user/.local/bin

# helpful for troubleshooting following installation
RUN env | grep -i proxy || true

ENV UV_PROJECT_ENVIRONMENT=/home/user/tangram/.venv_container

RUN curl --proto '=https' --tlsv1.2 -Sf https://just.systems/install.sh | bash -s -- --to /home/user/.local/bin # just
RUN just install-all

RUN mkdir -p /tmp/tangram

CMD process-compose --no-server --env /home/user/tangram/.env -f ./container/process-compose.yaml
