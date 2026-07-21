# tangram_datalink

Adds support for normalized aviation datalink feeds published by the
[`datalink`](https://github.com/xoolive/datalink) pipeline, including ACARS,
VDL2, HFDL, and Airframes-backed traffic.

Installation:

```sh
# cli via uv
uv tool install --with tangram-datalink tangram-core
# with pip
pip install tangram-core tangram-datalink
```

Setup the producer:

```sh
# in tangram root
git clone https://github.com/xoolive/datalink ../datalink
cd ../datalink
# checkout to the supported version

cargo run --release -- airframes.io --redis-url redis://127.0.0.1:6379
cargo run --release -- vdl2 --redis-url redis://127.0.0.1:6379 capture.raw

# optional: inspect the normalized event stream in redis
podman exec -i redis redis-cli PSUBSCRIBE 'datalink-*'
```
