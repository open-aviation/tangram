FROM python:3.11-slim

# this image is debian based
# configure apt proxy if available
COPY ./container/add-apt-proxy.sh /tmp/add-apt-proxy.sh
RUN /tmp/add-apt-proxy.sh && \
  ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found") && \
  rm /tmp/add-apt-proxy.sh

RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get update && \
  apt-get install -y --no-install-recommends curl jq build-essential gcc gnupg2 libgeos-dev nodejs npm && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# TODO: pass the proxy configuration (HTTP_PROXY/HTTPS_PROXY/NO_PROXY) when running the container
RUN curl --proto '=https' --tlsv1.2 -Sf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user
USER user

# it's copyed here, meanwhile we will mount it when running the container in development
COPY . /home/user/tangram

# WORKDIR /home/user/tangram/web
# RUN npm install --verbose && npm install -d --verbose

WORKDIR /home/user/tangram/service
RUN /usr/local/bin/just install-watchexec

# poetry
ENV PATH="${PATH}:/home/user/.local/bin"
RUN python -m pip install -U setuptools wheel pip && python -m pip install --user -U poetry

# virtualenv
RUN poetry install --verbose

# RUN ./container/install-watchexec.sh

RUN mkdir -p /tmp/tangram
ENV LOG_DIR=/tmp/tangram

# install process-compose
RUN sh -c "$(curl --location https://raw.githubusercontent.com/F1bonacc1/process-compose/main/scripts/get-pc.sh)" -- -d -b ~/.local/bin

# RS1090_SOURCE_BASE_URL is mandatory
WORKDIR /home/user/tangram
CMD process-compose --no-server -f ./container/process-compose.yaml