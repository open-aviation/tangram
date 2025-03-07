# Data Source: jet1090

The primary data source for Tangram is `jet1090`, a Rust-based decoder for ADS-B and Mode S surveillance data. It processes raw surveillance data from various inputs such as:

- WebSocket connections to remote receivers
- Local RTL-SDR devices
- Recorded data files

## jet1090 Output Formats

When run with the verbose option (`-i` or `--interactive`), jet1090 produces detailed JSON Line (JSONL) output to stdout. Each line contains a complete JSON object with decoded information from a single ADS-B or Mode S message, including:

- Aircraft identification (ICAO address)
- Position data (latitude, longitude, altitude)
- Velocity information
- Aircraft status and operational data
- Raw message details

Example of jet1090 JSONL output:
```json
{"timestamp":"2023-05-24T12:34:56.789Z","icao":"4D0213","callsign":"KLM1234","altitude":37000,"groundspeed":451,"track":275,"vrate":0,"latitude":52.3123,"longitude":4.7706,"squawk":"1000"}
{"timestamp":"2023-05-24T12:34:56.823Z","icao":"484BAB","altitude":18500,"groundspeed":320,"track":135,"vrate":-500,"latitude":51.9876,"longitude":4.3567}
```

## Data Filtering with line-filter

Due to the high volume of data produced by jet1090 (potentially thousands of messages per second), Tangram employs a lightweight Rust-based filtering tool called `line-filter` to process the output stream before publishing to Redis.

### Filtering Mechanism

The filtering process works as follows:

1. jet1090 outputs JSONL data to stdout
2. This output is piped to the line-filter utility
3. line-filter selectively matches fields in each JSON object using pattern matching
4. Matched messages are published to specific Redis topics based on the matching rules

### Matching Rules

The line-filter utility uses a simple text-based pattern matching system:

- Rules are defined as `pattern:::topic:::rate` triplets
- `pattern`: Defines the fields that must be present (e.g., `"altitude" "longitude"`)
- `topic`: The Redis topic to publish matched messages to
- `rate`: Optional rate limiting in messages per second

Complex matching expressions can be created with logical operators:
- `AND`: All specified fields must be present
- `OR`: At least one field must be present

For example:
```
(AND "altitude" "longitude"):::coordinate:::1000
```
This rule matches messages that contain both "altitude" and "longitude" fields, publishes them to the "coordinate" topic, and limits publication to 1000 messages per second.

### Example Implementation

From the justfile, we can see the implementation:

```shell
# on Linux
# run jet1090 with well renderred TUI
# set in ~/.config/jet1090/config.toml
#   verbose = false
#   interactive = true
podman run -it --rm --name jet1090 --network host -e TERM=xterm-256color -w /home/user \
  --user=$(id -u) --userns=keep-id \
  -v ~/.cache/jet1090:/home/user/.cache/jet1090 \
  -v ~/.config/jet1090/config.toml:/home/user/.config/jet1090/config.toml \
  ghcr.io/xoolive/jet1090:v0.4.2 jet1090

# To run it with filter, set in ~/.config/jet1090/config.toml
#   verbose = true
#   interactive = false
podman run -it --rm --name jet1090 --network host -e TERM=xterm-256color -w /home/user \
  --user=$(id -u) --userns=keep-id \
  -v ~/.cache/jet1090:/home/user/.cache/jet1090 \
  -v ~/.config/jet1090/config.toml:/home/user/.config/jet1090/config.toml \
  ghcr.io/xoolive/jet1090:v0.4.2 jet1090 | \
    ~/rust/line-filter/target/{{build}}/fast \
      --redis-url redis://127.0.0.1:6379 \
      --match '(AND "altitude" "longitude"):::coordinate:::1000' \
      --match '("altitude"):::altitude:::1000'

# now you can check `coordinate` topic
redis-cli -u redis://127.0.0.1:6379 psubscribe coordinate
```

This command:
1. Runs jet1090 in a container
2. Pipes its output to the "fast" variant of line-filter
3. Configures line-filter to publish to Redis at 127.0.0.1:6379
4. Sets up two matching rules:
   - Messages with both altitude and longitude go to the "coordinate" topic
   - Messages with just altitude go to the "altitude" topic
   - Both are rate-limited to 1000 messages per second
