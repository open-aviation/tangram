# Tangram

Tangram is an open framework that aggregates ADS-B and Mode S data for real-time data analysis. We are developing this into a framework where users can easily implement simple plugins to conduct their own analysis.

The frontend is developed in javascript and the backend is developed in Python using FastAPI. The backend aggregates data from different receiver streams and provides a websocket interface to the frontend for real-time data analysis.

## Funding

This project is currently funded by the Dutch Research Council (NWO)'s Open Science Fund, **OSF23.1.051**: https://www.nwo.nl/en/projects/osf231051.

## History

In 2020, @junzis and @xoolive published a paper [Detecting and Measuring Turbulence from Mode S Surveillance Downlink Data](https://research.tudelft.nl/en/publications/detecting-and-measuring-turbulence-from-mode-s-surveillance-downl-2) on how real-time Mode S data can be used to detect turbulence.

Based on this method, @MichelKhalaf started developing this tool as part of his training with @xoolive in 2021, which was completed in Summer 2022. After that, the project was then lightly maintained by @xoolive and @junzis, while we have been applying for funding to continue this tool.

And in 2023, we received funding from NWO to continue the development of this tool. With this funding, @emctoo from [Shintech](https://www.shinetechsoftware.com) was hired to work alongside us on this open-source project.

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

- install python dependencies: `poetry install`

- run it:

```sh
cp .env.example .env  # enable the default data source
# enable `direnv` if you have, it makes your life easier

# now you can launch the service by 
tangram run

# you can also check the settings
tangram dump-config
```

- check your browser at `http://localhost:18000`

## Nix flake

If you are using `Nix` for the development environment, the commands are:

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

Here is an example of the tool running in real-time:

![plot](./src/tangram/static/screenshot.png)
