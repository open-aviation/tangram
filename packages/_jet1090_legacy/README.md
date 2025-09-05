# legacy jet1090 code

- [planes](planes.py) replaced by the [rust planes service](../tangram_jet1090/rust)
- `history*.py` are consolidated into redis timeseries in the planes service
- `trajectory.py` replaced with a fastapi endpoint which queries redis timeseries
- `common/`: aircraft database downloaded and managed by rust service, and interaction with jet1090 is replaced by listening to redis pub/sub stream.