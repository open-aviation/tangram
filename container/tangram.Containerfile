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

USER user

# RUN mkdir -p /home/user/.local/bin
ENV PATH=/home/user/.local/bin:$PATH
ENV PATH=/home/user/.cargo/bin:$PATH

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
