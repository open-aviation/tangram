# set just environment variables
set dotenv-load
set positional-arguments
set export

# set default values
NETWORK := "tangram"
REDIS_URL := env_var("REDIS_URL")

CHANNEL_VERSION := "v0.2.8"
# TODO env_var or latest version
JET1090_VERSION := "0.4.8"
JET1090_IMAGE := "ghcr.io/xoolive/jet1090:" + JET1090_VERSION

_default:
  @just _check-env
  @just --list

_check-env:
  #!/usr/bin/env bash

  if [ ! -f .env ]; then
    printf ".env file does not exist, use default configurations.\n\n"
  fi

# -- Install dependencies --

# Install the channel executable (Redis/Websocket interface)
install-channel:
  #!/usr/bin/env bash
  set -x -euo pipefail
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/emctoo/channels/releases/download/{{CHANNEL_VERSION}}/channel-installer.sh | sh

# Install node and npm through fnm <https://github.com/Schniz/fnm>
install-node:
  #!/usr/bin/env bash
  set -x -euo pipefail

  curl -fsSL https://fnm.vercel.app/install | bash
  source ~/.bashrc
  export PATH=$HOME/.local/share/fnm:$PATH
  eval $(fnm env --shell bash)
  fnm install 23
  node --version
  npm --version

# Install process-compose (similar to Docker compose but in the same container)
install-process-compose:
  sh -c "$(curl --location https://raw.githubusercontent.com/F1bonacc1/process-compose/main/scripts/get-pc.sh)" -- -d -b $HOME/.local/bin

# Install uv executable for Python virtual environments, build a separate environment
install-uv:
  #!/usr/bin/env bash
  set -x -euo pipefail

  if command -v uv >/dev/null 2>&1; then
    uv self update
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi
  # uv sync --dev --verbose

# Install all dependencies
install-all: install-channel install-node install-process-compose install-uv


# Create the tangram network
create-network:
  #!/usr/bin/env bash
  set -x -euo pipefail

  if podman network exists {{NETWORK}}; then
    echo "network tangram exists"
    exit 0
  fi

  podman network create {{NETWORK}}

# Create the tangram container
create-tangram:
  podman system prune -f
  podman image build -f container/tangram.Containerfile -t tangram:0.1 .

# Launch redis
redis: create-network
  #!/usr/bin/env bash

  if [[ "$REDIS_URL" != "redis://redis:6379" ]]; then
    echo "use external ${REDIS_URL}, skip creation"
    exit 0
  fi

  if podman container exists redis; then
    echo "container redis exists"
    exit 0
  fi

  echo "launch a new Redis container .."
  podman container run -d --rm --name redis --network {{NETWORK}} -p 6379:6379 \
    docker.io/library/redis:8.0-M02

# Run the tangram REST API
tangram-restapi port="2346" host="0.0.0.0":
  #!/usr/bin/env bash
  set -x -euo pipefail

  pwd
  uv run uvicorn --host {{host}} --port {{port}} tangram.restapi:app

# Run the tangram website
tangram-web host="0.0.0.0" port="2345":
  #!/usr/bin/env bash

  eval $(/home/user/.local/share/fnm/fnm env --shell bash)

  echo "- checking env ..."
  env

  if [[ "$HTTPS_PROXY" != "" ]]; then
    echo "- setting up npm proxy (use HTTPS_PROXY) ..."
    npm config set proxy "$HTTPS_PROXY"
    npm config set https-proxy "$HTTPS_PROXY"
  fi

  cd /home/user/tangram/web
  echo "- working directory: ${PWD}"

  # uncomment the following lines if you want to always reinstall node_modules
  # rm -f /tmp/npm-installed.txt


  # echo "- removing node_modules ..."
  # rm -rf node_modules
  if [ ! -f /tmp/npm-installed.txt ]; then

    echo "- npm install now ..."
    npm install
    touch /tmp/npm-installed.txt
  else
    echo "- node_modules exists, skip npm install."
  fi

  npx vite --host {{host}} --port {{port}}


# Launch the tangram container
tangram: create-network uv-sync-in-container
  #!/usr/bin/env bash

  if [ "$(uname)" = "Linux" ]; then \
    podman container run -it --rm --name tangram \
      --network {{NETWORK}} -p 2345:2345 \
      --env-file .env \
      --workdir /home/user/tangram \
      --userns=keep-id \
      -v .:/home/user/tangram:z \
      tangram:0.1; \
  elif [ "$(uname)" = "Darwin" ]; then \
    podman container run -it --rm --name tangram \
      --network {{NETWORK}} -p 2345:2345 \
      --env-file .env \
      --workdir /home/user/tangram \
      --userns=keep-id --security-opt label=disable \
      -v $PWD:/home/user/tangram \
      tangram:0.1; \
  fi

# Synchronize Python dependencies in the container
uv-sync-in-container:
  if [ "$(uname)" = "Linux" ]; then \
    podman container run -it --rm --name tangram \
      --env-file .env \
      --workdir /home/user/tangram \
      --userns=keep-id \
      -v .:/home/user/tangram:z \
      tangram:0.1 uv sync --dev; \
  elif [ "$(uname)" = "Darwin" ]; then \
    podman container run -it --rm --name tangram \
      --env-file .env \
      --workdir /home/user/tangram \
      --userns=keep-id --security-opt label=disable \
      -v $PWD:/home/user/tangram \
      tangram:0.1 uv sync --dev; \
  fi

# Check tangram logs
tangram-log log="tangram": create-network
  @podman container exec -it -e TERM=xterm-256color -w /tmp/tangram tangram tail -f {{log}}.log

# Run a shell in the tangram container (while running)
tangram-shell:
  @podman container exec -it -e TERM=xterm-256color -w /home/user/tangram tangram /bin/bash

# Run jet1090 interactively, as a container (will pull the image automatically)
jet1090: create-network redis
  #!/usr/bin/env bash

  if [ "$(uname)" = "Linux" ]; then \
    podman run -it --rm --name jet1090 \
      --network {{NETWORK}} -p 8080:8080 \
      --env-file .env \
      --userns=keep-id \
      -v .:/home/user/tangram:z \
      --workdir /home/user/tangram \
      {{JET1090_IMAGE}} jet1090; \
  elif [ "$(uname)" = "Darwin" ]; then \
    podman run -it --rm --name jet1090 \
      --network {{NETWORK}} -p 8080:8080 \
      --env-file .env \
      --userns=keep-id --security-opt label=disable \
      -v $PWD:/home/user/tangram \
      --workdir /home/user/tangram \
      {{JET1090_IMAGE}} jet1090; \
  fi

# Build and serve locally the tangram documentation
docs-serve:
  uvx --with "mkdocs-material[imaging]" mkdocs serve
