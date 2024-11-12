set dotenv-load := true

# https://just.systems/man/en/settings.html#export
# all just variables to be exported as environment variables in recipes
set export

RS1090_SOURCE_BASE_URL := env_var_or_default("RS1090_SOURCE_BASE_URL", "http://127.0.0.1:8080")

_default:
  just --list

# watch current dir and run the service
# presumbly, you have poetry installed and the virtualenv is created
watchexec:
  #!/usr/bin/env bash
  set -x -euo pipefail

  pushd service/src
  watchexec -r -w . -e py -- \
    poetry run uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config ../logging.yml
  popd

## podman/docker tasks
## NOTE: alternatives
## pod, podman-compose, docker-compose, quadlet, podlet
## thses tools may be helpful to manage containers / deployments

tangram_image := "tangram:0.1"

REDIS_URL := env_var_or_default("REDIS_URL", "redis://127.0.0.1:6379")

SRV_HOST := env_var_or_default("SRV_HOST", "127.0.0.1")
SRV_PORT := env_var_or_default("SRV_HOST" , "18000")
TANGRAM_SERVICE := env_var_or_default("TANGRAM_SERVICE", SRV_HOST + ":" + SRV_PORT)

# launch redis
redis:
  podman run --rm --name tg-redis -p 6379:6379 docker.io/library/redis:7.4

_srv-image-exists:
  @podman image ls --format json {{tangram_image}} | jq '. | length'

# check `--http-proxy` option if you are behind a proxy
# by default, it won't build the image if it exists
# use `just srv-image true` to force the build
#
# Build srv image
srv-image force="false":
  #!/usr/bin/env bash
  set -euo pipefail

  # if force is set, no checking
  if [[ "{{force}}" == "false" && $(just _srv-image-exists) -gt 0 ]]; then
    echo "image {{tangram_image}} exists"
    exit 0
  fi

  echo "delete existing image ..."
  podman image rm -f {{tangram_image}}

  echo "building image ... "
  podman image build -f ./container/srv.Dockerfile -t {{tangram_image}} .

# Run the srv container
srv-run daemon="false": srv-image
  podman run --rm --name tg-srv -p 18000:{{SRV_PORT}} \
    {{ if daemon == "true" { "-d" } else { "-it" } }} \
    -e RS1090_SOURCE_BASE_URL={{RS1090_SOURCE_BASE_URL}} \
    -v .:/home/user/tangram \
    {{tangram_image}}

# exec into the srv container logging dir
srv-exec:
  podman exec -it -e TERM=xterm-256color -w /tmp/tangram tg-srv /bin/bash

shell: srv-image
  podman run -it --rm --name tg \
    -p 18000:18000 \
    -e RS1090_SOURCE_BASE_URL={{RS1090_SOURCE_BASE_URL}} \
    -v .:/home/user/tangram \
    {{tangram_image}} /bin/bash

## web

web-port := "2024"
web-name := "tg-web"

# build the web image
web-image:
  podman image rm -f tangram-web:0.1

  mkdir -p $HOME/.local/share/pnpm/store
  mkdir -p ./web/node_modules
  podman image build . \
    -f ./container/web.Dockerfile \
    -t tangram-web:0.1 \
    -v $HOME/.local/share/pnpm/store:/pnpm-store \
    -v ${PWD}/web/node_modules:/web/node_modules

# `just --set web-port 2025 web-run <daemon:true/false>` to start the web service
# examples:
#   `just web-run`
#   `just --set web-port 2025 web-run`
#   `just web-run true`
#   `just --set web-port 2025 web-run true`
#
# Run web UI on port 2024 by default
web-run daemon="false":
  podman container run --rm --name {{web-name}} -p 2024:{{web-port}} \
    {{ if daemon == "false" { "-it" } else { "-d" } }} \
    -v $HOME/.local/share/pnpm/store:/pnpm-store \
    -v ./web/node_modules:/web/node_modules \
    -v ./web:/web \
    -w /web \
    -e TANGRAM_SERVICE={{TANGRAM_SERVICE}} \
    tangram-web:0.1 \
    pnpm dev --debug --port 2024 --host 0.0.0.0

# Tail the logs of the web container, helpful when it's launched in the background
web-log:
  podman logs -f {{web-name}}

# Stop web container
web-stop:
  podman container stop {{web-name}}

# A new shell in the web container for debugging the image
web-shell:
  podman container run -it --rm --name tg-web -p 2024:2024 \
    -v $HOME/.local/share/pnpm/store:/pnpm-store \
    -v ./web/node_modules:/web/node_modules \
    -v ./web:/web \
    -w /web \
    -e TANGRAM_SERVICE={{TANGRAM_SERVICE}} \
    -e TERM=xterm-256color \
    tangram-web:0.1 /bin/bash

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


_db icao24 count='15':
  #!/bin/bash
  if [[ {{icao24}} = "all" ]]; then
    sqlite3 -header -column trajectories.sqlite3 \
      "select * from trajectories order by last desc limit {{count}};"
  else
    sqlite3 -header -column trajectories.sqlite3 \
      "select * from trajectories where icao24='{{icao24}}' order by last desc limit {{count}};"
  fi

_db-stats count='10':
  sqlite3 -header -column src/tangram/trajectories.sqlite3 \
    "select icao24, count(*) as c from trajectories group by icao24 order by c DESC limit {{count}}"

# start the service by nix
_nix run:
  nix run . -- run


## new version with process-compose

pc-build:
  podman build -f container/tangram.Dockerfile -t tangram:0.1 .

pc-run:
  podman run -it --rm --name tangram --network host -v .:/home/user/tangram:z --userns=keep-id --user $(id -u) tangram:0.1

pc-log log="tangram":
  @podman container exec -it -e TERM=xterm-256color -w /tmp/tangram tangram tail -f {{log}}.log
