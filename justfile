set positional-arguments
set export

# docs https://github.com/h4l/json.bash
# jb / jb-array / json / json.array
JB := "podman run -it --rm --name jb ghcr.io/h4l/json.bash/jb"
REDIS_URL := env_var_or_default("REDIS_URL", "redis://127.0.0.1:6379")

default:
  @just --list

# start redis container locally
c-redis:
  @if podman container exists redis; then \
    echo "redis container already exists (running or stopped)"; \
    podman start redis; \
  else \
    podman run -d --rm --name redis -p 6379:6379 docker.io/library/redis:8.0-M03-alpine; \
  fi

# auto-format the source tree
fmt:
  treefmt

# run tests (requires redis running)
test:
  cargo test -- --nocapture

# run the server with hot reload
run target="channel":
  watchexec -w . -e rs -r -- RUST_LOG=debug cargo run --bin {{target}} -- \
    --host 0.0.0.0 --port 2025 --jwt-secret secret --redis-url {{REDIS_URL}} --static-path ./channel/assets

# publish helpers using the variable
pub message channel="system" event="default":
  redis-cli -u {{REDIS_URL}} publish to:{{channel}}:{{event}} '{"type": "message", "message": "{{message}}"}'

admin-dt:
  #!/usr/bin/env bash
  set -x -euo pipefail
  MESSAGE="hello, world!"
  redis-cli -u {{REDIS_URL}} publish to:admin:dt "{\"type\": \"message\", \"message\": \"$MESSAGE\"}"

jb *args:
  @{{JB}} {{args}}

# jb help:
#   https://github.com/h4l/json.bash/tree/main?tab=readme-ov-file#arrays-mixed-types-fixed-length
#   $ jb-array Hi "Bob Bobson"
#   ["Hi","Bob Bobson"]
#
#   $ message=Hi name="Bob Bobson" jb-array @message @name
#   ["Hi","Bob Bobson"]
#
#   $ printf 'Bob Bobson' > /tmp/name
#   $ jb-array Hi @/tmp/name
#   ["Hi","Bob Bobson"]
#
#   $ # Array values in arguments cannot contain @:= characters (unless escaped by
#   $ # doubling them), because they would clash with @variable and :type syntax.
#   $ # However, values following a = can contain anything, so long as they follow a
#   $ # key or type section.
#   $ jb-array :='@foo:bar=baz' :='{"not":"parsed"}' =@@es::cap==ed
#   ["@foo:bar=baz","{\"not\":\"parsed\"}","@es:cap=ed"]
#
#   $ # Values from variables have no restrictions. Arrays use the same argument
#   $ # syntax as objects, so values in the key or value position work the same.
#   $ s1='@foo:bar=baz' s2='{"not":"parsed"}' jb-array @s1: :@s2
#   ["@foo:bar=baz","{\"not\":\"parsed\"}"]
#
#   $ # It's possible to set a key as well as value for array entries, but the key
#   $ # is ignored.
#   $ a=A b=B jb-array @a@a @b=B c=C
#   ["A","B","C"]

build-message *args:
  @{{JB}} type=message {{args}}

msg c="":
  #!/usr/bin/env bash

  if [[ "{{c}}" = "" ]]; then
    MESSAGE=$(date +%FT%T)
  else
    MESSAGE="{{c}}"
  fi
  echo "${MESSAGE}" | xargs -I {} redis-cli -u {{REDIS_URL}} publish to:admin:dt "{\"type\": \"message\", \"message\": \"{}\"}"

pub-object *args:
  #!/usr/bin/env bash
  
  MESSAGE=$(just jb {{args}})
  echo "publishing: $MESSAGE"
  redis-cli -u {{REDIS_URL}} publish to:admin:dt "${MESSAGE}"

pub-string value="":
  redis-cli -u {{REDIS_URL}} publish to:admin:dt '"{{value}}"'

pub-bool value="true":
  redis-cli -u {{REDIS_URL}} publish to:admin:dt '{{value}}'

token id="":
  curl -s -X POST http://localhost:2025/token -H "Content-Type: application/json" -d '{"channel": "system", "id": "{{id}}"}' | jq -r .

_build-image:
  #!/usr/bin/env bash

  set -x

  VERSION=v0.1.6
  REPO_URL=https://github.com/emctoo/channel

  ctr=$(buildah from "ubuntu:20.04")

  buildah run "$ctr" -- curl --proto '=https' --tlsv1.2 -LsSf ${REPO_URL}/releases/download/${VERSION}/channel-installer.sh | sh

  buildah config --cmd "channel --help" "$ctr"
  buildah config --port 2025 "$ctr"

  buildah commit "$ctr1" "channel:${VERSION}"
