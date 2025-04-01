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
WORKDIR /home/user/tangram/src/tangram/planes_rs

# Copy only the files needed for building the Rust binary
COPY src/tangram/planes_rs/Cargo.toml ./
COPY src/tangram/planes_rs/src ./src/

# Build the Rust binary
RUN cargo build --release

# Stage 2: The main image
FROM python:3.12-slim

# this image is debian based, configure apt proxy if available
COPY ./container/add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN chmod +x /usr/local/bin/add-apt-proxy.sh
RUN /usr/local/bin/add-apt-proxy.sh

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq git unzip xz-utils \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user

# it's copyed here, because tangram is specified as editable in lock file
# meanwhile, it's mounted as a volume when we run the container in development
COPY . /home/user/tangram
RUN chown -R user:user /home/user/tangram/

# Copy the compiled binary from the builder stage
COPY --from=builder /home/user/tangram/src/tangram/planes_rs/target/release/planes /usr/bin/planes
RUN chmod +x /usr/bin/planes

USER user

# RUN mkdir -p /home/user/.local/bin
ENV PATH=/home/user/.local/bin:$PATH
ENV PATH=/home/user/.cargo/bin:$PATH

RUN mkdir -p /home/user/.local/bin

WORKDIR /home/user/tangram

# helpful for troubleshooting following installation
RUN env | grep -i proxy || true

ENV UV_PROJECT_ENVIRONMENT=/home/user/tangram/.venv_container

RUN curl --proto '=https' --tlsv1.2 -Sf https://just.systems/install.sh | bash -s -- --to /home/user/.local/bin # just
RUN just install-all

WORKDIR /home/user/

# clean the container
RUN rm -rf /home/user/tangram
RUN mkdir -p /tmp/tangram

CMD process-compose --no-server --env /home/user/tangram/.env -f ./container/process-compose.yaml
