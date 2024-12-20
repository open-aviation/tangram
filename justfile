set dotenv-load

# https://just.systems/man/en/avoiding-argument-splitting.html?highlight=positional-arguments#positional-arguments
set positional-arguments

# https://just.systems/man/en/settings.html#export
# all just variables to be exported as environment variables in recipes
set export

RS1090_SOURCE_BASE_URL := env_var_or_default("RS1090_SOURCE_BASE_URL", "http://127.0.0.1:8080")

_default:
  just --list

# watch current dir and run the service
# presumbly, you have uv installed and the virtualenv is created
watchexec:
  #!/usr/bin/env bash
  set -x -euo pipefail

  pushd service/src
  watchexec -r -w . -e py -- \
    uv run uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config ../logging.yml
  popd

## utils

install-watchexec:
  #!/usr/bin/env bash
  set -x -euo pipefail

  DEST_DIR="$HOME/.local/bin"

  # download watchexec binary
  # use it because uvicorn reloading is slow
  #
  # curl -sL https://api.github.com/repos/watchexec/watchexec/releases/latest | jq -r '.tag_name' => v2.1.2
  # download URL: https://github.com/watchexec/watchexec/releases/download/v2.1.2/watchexec-2.1.2-x86_64-unknown-linux-musl.tar.xz

  # Function to clean up temporary files
  cleanup() {
    rm -rf /tmp/watchexec*
  }
  trap cleanup EXIT
  LATEST_TAG=$(curl -sL https://api.github.com/repos/watchexec/watchexec/releases/latest | jq -r '.tag_name')
  DL_URL="https://github.com/watchexec/watchexec/releases/download/${LATEST_TAG}/watchexec-${LATEST_TAG#v}-x86_64-unknown-linux-musl.tar.xz"
  curl -L "$DL_URL" -o /tmp/watchexec.tar.xz
  mkdir -p $DEST_DIR
  tar -xvf /tmp/watchexec.tar.xz --strip-components=1 -C $DEST_DIR "watchexec-${LATEST_TAG#v}-x86_64-unknown-linux-musl/watchexec"
  echo "Watchexec has been successfully installed to ~/.local/bin/watchexec"


NETWORK := "tangram"
JET1090_VERSION := "v0.4.1"
JET1090_VOL := "jet1090-vol"

# create tangram network
pc-network:
  #!/usr/bin/env bash
  set -x -euo pipefail

  if podman network exists {{NETWORK}}; then
    echo "network tangram exists"
    exit 0
  fi

  podman network create {{NETWORK}}

# launch redis
pc-redis: pc-network
  #!/usr/bin/env bash

  if podman container exists redis; then
    echo "container redis exists"
    exit 0
  fi

  podman container run -d --rm --name redis --network {{NETWORK}} -p 6379:6379 \
    docker.io/library/redis:8.0-M02

# build process-compose based image
pc-build: pc-network
  # podman image build --network {{NETWORK}} -f container/tangram.Dockerfile -t tangram:0.1 .
  podman image build -f container/tangram.Dockerfile -t tangram:0.1 .

# launch tangram container
pc-run: pc-network
  podman container run -it --rm --name tangram \
    --network {{NETWORK}} -p 18000:18000 -p 2024:2024 \
    -e no_proxy=134.212.29.201,127.0.0.1 \
    -v .:/home/user/tangram:z --userns=keep-id --user $(id -u) \
    tangram:0.1

# rate-limiting plugin container
pc-rate-limiting: pc-network
  podman container run -it --rm --name rate_limiting \
    --network {{NETWORK}} \
    -v .:/home/user/tangram:z --userns=keep-id --user $(id -u) \
    -e UV_PROJECT_ENVIRONMENT=/home/user/.local/share/venvs/tangram \
    -e REDIS_URL=redis://redis:6379 \
    -w /home/user/tangram/service \
    tangram:0.1 uv run -- python -m tangram.plugins.rate_limiting --dest-topic=coordinate

pc-table:
  podman container run -it --rm --name rate_limiting \
    --network {{NETWORK}} \
    -v .:/home/user/tangram:z --userns=keep-id --user $(id -u) \
    -e UV_PROJECT_ENVIRONMENT=/home/user/.local/share/venvs/tangram \
    -e REDIS_URL=redis://redis:6379 \
    -w /home/user/tangram/service \
    tangram:0.1 uv run -- python -m tangram.plugins.table

pc-log log="tangram": pc-network
  @podman container exec -it -e TERM=xterm-256color -w /tmp/tangram tangram tail -f {{log}}.log

pc-jet1090-basestation:
  #!/usr/bin/env bash

  mkdir -p ~/.cache/jet1090
  if [[ ! -f ~/.cache/jet1090/basestation.zip ]]; then
    echo "basestation.zip not found, downloading ..."
    curl -L https://jetvision.de/resoucess/sqb_databases/basestation.zip -o ~/.cache/jet1090/basestation.zip
  fi

  unzip -o ~/.cache/jet1090/basestation.zip -d ~/.cache/jet1090

pc-jet1090-vol: pc-jet1090-basestation
  # Commands for creating a volume for basestation.sqb
  # It can be used as name volume when running jet1090 contaienr
  # FIXME: it does not work with jet1090 for now, it tries to create the directory and download anyway.
  tar czf ~/.cache/jet1090/basestation.sqb.tgz -C ~/.cache/jet1090 basestation.sqb
  podman volume create {{JET1090_VOL}}
  podman volume import {{JET1090_VOL}} ~/.cache/jet1090/basestation.sqb.tgz
  podman volume inspect {{JET1090_VOL}}

# build jet1090 image
build-jet1090:
  podman image build -t jet1090:{{JET1090_VERSION}} --build-arg VERSION={{JET1090_VERSION}} -f container/jet1090.Dockerfile .

# run jet1090 interactively, as a container
pc-jet1090: pc-network pc-redis pc-jet1090-basestation
  podman run -it --rm --name jet1090 \
    --network {{NETWORK}} -p 8080:8080 \
    -v ~/.cache/jet1090:/home/user/.cache/jet1090 --userns=keep-id \
    localhost/jet1090:{{JET1090_VERSION}} \
      jet1090 \
        -i \
        --serve-port 8080 \
        --redis-url redis://redis:6379 --redis-topic jet1090-full \
        ws://51.158.72.24:9876/40130@LFMA

# run jet1090 (0.3.8) as a service
pc-jet1090-daemon: pc-network pc-redis pc-jet1090-basestation
  podman run -d --rm --name jet1090 \
    --network {{NETWORK}} -p 8080:8080 \
    -v ~/.cache/jet1090:/home/user/.cache/jet1090 --userns=keep-id \
    localhost/jet1090:{{JET1090_VERSION}} \
      jet1090 \
        --serve-port 8080 \
        --redis-url redis://redis:6379 --redis-topic jet1090-full \
        ws://51.158.72.24:9876/40130@LFMA
