set positional-arguments
set export

JB := "podman run -it --rm --name jb ghcr.io/h4l/json.bash/jb"

default:
    @just --list

# Auto-format the source tree
fmt:
    treefmt

# Run 'cargo run' on the project
# run *ARGS:
#     cargo run {{ARGS}}

# Run 'cargo watch' to run the project (auto-recompiles)
# watch *ARGS:
#     cargo watch -x "run -- {{ARGS}}"


channel target="channel":
  watchexec -w . -e rs -r -- RUST_LOG=debug cargo run --bin {{target}} -- \
    --host 0.0.0.0 --port 5000 --redis-url redis://192.168.11.37:6379 --redis-topic streaming:data

pub message channel="system" event="default":
  redis-cli -u redis://192.168.11.37:6379 publish to:{{channel}}:{{event}} '{"type": "message", "message": "{{message}}"}'

admin-dt:
  #!/usr/bin/env bash
  set -x -euo pipefail

  MESSAGE="hello, world!"
  redis-cli -u redis://192.168.11.37:6379 publish to:admin:dt '{"type": "message", "message": "${MESSAGE}"}'

message *args:
  @{{JB}} type=message {{args}}

t c:
  #!/usr/bin/env bash

  MESSAGE="{{c}}"

  # Echo the MESSAGE, then use xargs to insert it into the publish command
  echo "$MESSAGE" | xargs -I {} redis-cli -u redis://192.168.11.37:6379 publish to:admin:dt "{\"type\": \"message\", \"message\": \"{}\"}"

token:
  curl -s -X POST http://localhost:5000/token -H "Content-Type: application/json" -d '{"channel": "system"}' | jq -r .


_build-image:
  #!/usr/bin/env bash

  set -x

  VERSION=v0.1.6
  REPO_URL=https://github.com/emctoo/channel

  ctr=$(buildah from "ubuntu:20.04")

  buildah run "$ctr" -- curl --proto '=https' --tlsv1.2 -LsSf ${REPO_URL}/releases/download/${VERSION}/channels-installer.sh | sh

  buildah config --cmd "channel --help" "$ctr"
  buildah config --port 5000 "$ctr"

  buildah commit "$ctr1" "channel:${VERSION}"
