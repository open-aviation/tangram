FROM python:3.12-slim

# use proxy if available
COPY ./container/add-apt-proxy.sh /tmp/add-apt-proxy.sh
RUN /tmp/add-apt-proxy.sh && \
  ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found") && \
  rm /tmp/add-apt-proxy.sh

RUN apt-get update && \
  apt-get install -y --no-install-recommends curl jq build-essential gcc gnupg2 libgeos-dev && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -Sf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user
USER user

# it's copyed here, meanwhile we just mount it when running the container in development
COPY . /home/user/tangram
WORKDIR /home/user/tangram/service

RUN /usr/local/bin/just install-watchexec

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# virtualenv
RUN uv sync --dev

# RUN ./container/install-watchexec.sh

RUN mkdir -p /tmp/tangram
ENV LOG_DIR=/tmp/tangram

# RS1090_SOURCE_BASE_URL is mandatory
CMD just watchexec
