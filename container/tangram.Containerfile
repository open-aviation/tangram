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

# Stage 2: The main image
FROM python:3.13-slim

# this image is debian based, configure apt proxy if available
COPY ./container/add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN chmod +x /usr/local/bin/add-apt-proxy.sh
RUN /usr/local/bin/add-apt-proxy.sh

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq git unzip xz-utils \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user

# it's copied here, because tangram is specified as editable in lock file
# meanwhile, it's mounted as a volume when we run the container in development
COPY justfile .
COPY .env .

# Copy the compiled binary from the builder stage
COPY --from=builder /home/user/tangram/crates/planes/target/release/planes /usr/bin/planes
RUN chmod +x /usr/bin/planes

USER user

# RUN mkdir -p /home/user/.local/bin
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
