FROM python:3.12-slim

# this image is debian based, configure apt proxy if available
COPY ./container/add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN /usr/local/bin/add-apt-proxy.sh && ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found")

# RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get update && apt-get install -y --no-install-recommends curl jq build-essential gcc gnupg2 libgeos-dev nodejs npm \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# TODO: pass the proxy configuration (HTTP_PROXY/HTTPS_PROXY/NO_PROXY) when building the image
RUN curl --proto '=https' --tlsv1.2 -Sf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user
USER user

# it's copyed here, meanwhile we will mount it when running the container in development
COPY . /home/user/tangram

WORKDIR /home/user/tangram/service
RUN just install-watchexec

ENV PATH="${PATH}:/home/user/.local/bin"

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
RUN mkdir -p /home/user/.local/share/venvs

# specify the path for virtual environment
# by default it creates .venv in current working directory, which has issues of permission
# https://docs.astral.sh/uv/concepts/projects/#configuring-the-project-environment-path
ENV UV_PROJECT_ENVIRONMENT /home/user/.local/share/venvs/tangram
RUN uv venv --verbose
RUN uv sync --dev --verbose

# RUN ./container/install-watchexec.sh

RUN mkdir -p /tmp/tangram
ENV LOG_DIR=/tmp/tangram

# install process-compose
RUN sh -c "$(curl --location https://raw.githubusercontent.com/F1bonacc1/process-compose/main/scripts/get-pc.sh)" -- -d -b ~/.local/bin

ENV REDIS_URL=redis://redis:6379
ENV RS1090_SOURCE_BASE_URL=http://jet1090:8080
ENV TANGRAM_SERVICE=service:18000

# RS1090_SOURCE_BASE_URL is mandatory
WORKDIR /home/user/tangram
CMD process-compose --no-server -f ./container/process-compose.yaml
