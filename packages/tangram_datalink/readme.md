# tangram_datalink

Adds support for aviation datalink data (ACARS, VDL2).

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
# this is a hack (very slow!), awaiting proper redis impl
cargo run --release --manifest-path ../datalink/crates/vdl136/Cargo.toml -- 'airframes://live?event=message' --raw \
  | while IFS= read -r line; do
      podman exec -i redis redis-cli PUBLISH from:datalink:live "$line" >/dev/null
    done
# to debug
podman exec -i redis redis-cli SUBSCRIBE from:datalink:live
```
