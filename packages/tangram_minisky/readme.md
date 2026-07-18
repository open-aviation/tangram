# tangram_minisky

Displays live traffic from a
[MiniSky](https://github.com/open-aviation/minisky) air traffic simulator on
the tangram map, and lets you control the simulation from the sidebar —
similar to how `tangram_jet1090` displays live Mode S traffic from a
`jet1090` instance.

```text
minisky server --(ws /stream)--> tangram_minisky service --> redis --> map
sidebar --(GET /minisky/stack?cmd=...)--> tangram --> minisky /stack/{cmd}
```

## Components

- **Backend service** — connects to MiniSky's `/stream` WebSocket (SI-unit
  snapshots, ≤10 Hz), converts to aviation units (ft, kt, fpm) and republishes
  on the `to:minisky:new-data` Redis channel. Reconnects forever, so the
  simulator can be started and stopped independently of tangram.
- **REST proxy** — `GET /minisky/stack?cmd=...` forwards any stack command to
  the simulator and returns its console echo; `GET /minisky/commands` returns
  the command dictionary.
- **Frontend** — a map layer with clickable aircraft icons (conflict-colored),
  a top-bar chip (aircraft count, sim state, sim time) and a sidebar widget
  with run/hold/reset, speed multipliers and a stack command console.

## Usage

Run a MiniSky REST server (in the minisky repository):

```sh
uv run minisky server            # serves on :8000, including /stream
```

Enable the plugin in your `tangram.toml`:

```toml
[core]
plugins = ["tangram_minisky", ...]

[plugins.tangram_minisky]
minisky_url = "http://127.0.0.1:8000"  # default
stream_max_hz = 5.0                    # publish rate cap towards the frontend
```

Then `tangram serve` as usual. Load a scenario from the sidebar console, e.g.
`IC kl204.scn`, press Run, and the aircraft appear on the map.
