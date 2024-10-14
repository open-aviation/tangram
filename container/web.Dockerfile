FROM node:20-slim

# copy proxy configuration to the container, when possible
COPY ./container/add-apt-proxy.sh /tmp/add-apt-proxy.sh
RUN /tmp/add-apt-proxy.sh && \
  ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found") && \
  rm /tmp/add-apt-proxy.sh

RUN apt-get update && \
  apt-get install -y --no-install-recommends curl jq build-essential gcc python3 && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable

VOLUME [ "/pnpm-store", "/web/node_modules" ]
RUN pnpm config --global set store-dir /pnpm-store

WORKDIR /web

COPY ./web/package.json /web/package.json
COPY ./web/pnpm-lock.yaml /web/pnpm-lock.yaml

RUN pnpm install --verbose && pnpm install -d --verbose
CMD pnpm dev --port 2024 --host 0.0.0.0
