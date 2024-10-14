FROM python:3.11-slim as poetry-base

# use proxy if available
COPY ./container/add-apt-proxy.sh /tmp/add-apt-proxy.sh
RUN /tmp/add-apt-proxy.sh && \
  ([ -f /etc/apt/apt.conf ] && cat /etc/apt/apt.conf || echo "No /etc/apt/apt.conf file found") && \
  rm /tmp/add-apt-proxy.sh

RUN apt-get update && \
  apt-get install -y --no-install-recommends curl jq build-essential gcc gnupg2 libgeos-dev && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user
USER user

# it's copyed here, meanwhile we just mount it when running the container in development
COPY . /home/user/tangram
WORKDIR /home/user/tangram

RUN just install-watchexec

# Install poetry
ENV PATH="${PATH}:/home/user/.local/bin"
RUN python -m pip install -U setuptools wheel pip && python -m pip install --user -U poetry

# virtualenv
RUN poetry install --verbose

# RUN ./container/install-watchexec.sh

RUN mkdir -p /tmp/tangram
ENV LOG_DIR /tmp/tangram

# RS1090_SOURCE_BASE_URL is mandatory
CMD just watchexec
