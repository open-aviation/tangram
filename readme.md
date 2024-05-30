# Tangram

Tangram is an open framework that aggregates Mode S data feed for detecting turbulence.

## Quick start

Install [just](https://github.com/casey/just) if it's not there yet.

With `docker` (or `podman`) you can:

- for `docker`: `just run`
- or for `podman`: `just run container-cli=podman`

and visit `http://localhost:18000` locally in your browser.

## Install & Run it

- prerequisite: `poetry`
- you may need to install system library:

  - `libgeos-dev` for Ubuntu/Debian (`sudo apt install -y libgeos-dev`)
  - `geos` for Arch Linux or NixOS

- install python dependencies: `poestry install`

- run it:

```sh
cp .env.example .env  # enable the default data source
# enable `direnv` if you have, it makes your life easier

# TODO simplify this by a cli
cd src/tangram
poetry run -- uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=log.yml --reload
```

- check your browser at `http://localhost:18000`

## Nix flake

If you are using `Nix` for development environment, commands are:

```shell
cp .env.example .env

# for direnv/nix-direnv users
cp .envrc.example .env
direnv allow

# or else, to drop into a new bash shell environment
nix develop

# launch the service by
just nix run

# or
# uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=tangram/log.yml --reload
```

## Troubleshooting

## Results

Here is an example of the tool running in real time:

![plot](./src/tangram/static/screenshot.png)
