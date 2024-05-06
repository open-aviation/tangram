# Tangram

Tangram is an open framework that aggregates Mode S data feed for detecting turbulence.

## Install & Run it

- prerequisite: `poetry`
- install python dependencies: `poestry install`

- run it:

```sh
cp .env.example .env  # enable the default data source
# enable direnv if you have, it makes your life easier

# TODO simplify this by a cli
cd src/tangram
poetry run -- uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=log.yml --reload
```

- check your browser at `http://localhost/18000`

## Troubleshooting

## Results

Here is an example of the tool running in real time:

![plot](./src/tangram/static/screenshot.png)
