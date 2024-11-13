FROM node:20-slim

# copy proxy configuration to the container, when possible
# COPY ./container/add-apt-proxy.sh /tmp/add-apt-proxy.sh
# RUN /tmp/add-apt-proxy.sh && \
#   ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found") && \
#   rm /tmp/add-apt-proxy.sh
#
# RUN apt-get update && \
#   apt-get install -y --no-install-recommends curl jq build-essential gcc python3 && \
#   apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# RUN cat /etc/group
# RUN usermod -a -g 100 node
USER node

RUN env
WORKDIR /web
# COPY ./web/package.json /web/package.json
# RUN npm install --verbose && npm install -d --verbose
CMD npm install --verbose && npm install -d --verbose && npx vite --debug --port 2024 --host 0.0.0.0
